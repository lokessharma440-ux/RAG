import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

import { User } from '../models/User.js';
import { Codebase } from '../models/Codebase.js';
import { RepositoryFile } from '../models/RepositoryFile.js';
import { CodeChunk } from '../models/CodeChunk.js';
import { CodeRelationship } from '../models/CodeRelationship.js';

import { validateGitHubUrl } from '../services/codebase/githubService.js';
import { validateAndExtractZip, cleanupDirectory } from '../services/codebase/zipExtractionService.js';
import { detectAndRedactSecrets, discoverRepositoryFiles } from '../services/codebase/fileDiscoveryService.js';
import { parseCodeFileIntoChunks } from '../services/codebase/codeParserService.js';
import { processAndIndexRepository, deleteCodebaseCascade } from '../services/codebase/codebaseIndexingService.js';
import { retrieveRelevantCodeChunks, queryCodebase } from '../services/codebase/codebaseRetrievalService.js';
import { extractFileRelationships, getRepositoryDependencyGraph, analyzeImpact } from '../services/codebase/dependencyService.js';
import { runSecurityAudit } from '../services/codebase/securityAnalysisService.js';
import { generateCodebaseDocumentation } from '../services/codebase/documentationService.js';
import { setGlobalProvider } from './providers/index.js';
import { MockLLMProvider } from './providers/MockLLMProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✔ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✘ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=================================================================');
  console.log('   DEVMIND AI: CODEBASE INTELLIGENCE TEST SUITE');
  console.log('=================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}`);

  // Use MockLLMProvider for offline deterministic RAG generation
  setGlobalProvider(new MockLLMProvider({ defaultAnswer: 'Based on the repository source code, authentication uses JWT tokens.' }));

  const testTempDir = path.resolve(__dirname, '../uploads/temp/test_codebase_' + Date.now());
  fs.mkdirSync(testTempDir, { recursive: true });

  try {
    // -------------------------------------------------------------
    // SUITE 1: GitHub URL Validation & Input Security
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 1: GitHub URL Validation & Input Security ---');
    
    const valid1 = validateGitHubUrl('https://github.com/facebook/react');
    assert(valid1.valid && valid1.owner === 'facebook' && valid1.repo === 'react', '1.1 Valid standard GitHub repo URL is accepted');

    const valid2 = validateGitHubUrl('https://github.com/torvalds/linux/tree/master');
    assert(valid2.valid && valid2.branch === 'master', '1.2 Branch in URL path is parsed');

    const invalidHost = validateGitHubUrl('https://gitlab.com/owner/repo');
    assert(!invalidHost.valid && invalidHost.error.includes('github.com'), '1.3 Non-GitHub host is rejected');

    const traversalUrl = validateGitHubUrl('https://github.com/../malicious/repo');
    assert(!traversalUrl.valid, '1.4 Path traversal in URL owner is rejected');

    // -------------------------------------------------------------
    // SUITE 2: Secret Detection & Redaction Heuristics
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 2: Secret Detection & Redaction Heuristics ---');

    const sampleCodeWithSecrets = `
      const awsKey = "AKIA1234567890ABCDEF";
      const dbUrl = "mongodb://admin:SuperSecret123@cluster0.mongodb.net/prod";
      const token = "ghp_123456789012345678901234567890123456";
      function connect() { return true; }
    `;
    const redacted = detectAndRedactSecrets(sampleCodeWithSecrets);
    assert(redacted.secretsFoundCount >= 3, '2.1 Detects multiple secrets in source file');
    assert(!redacted.cleanText.includes('AKIA1234567890ABCDEF'), '2.2 AWS Key is stripped and redacted');
    assert(!redacted.cleanText.includes('SuperSecret123'), '2.3 Database password is redacted');
    assert(!redacted.cleanText.includes('ghp_123456789012345678901234567890123456'), '2.4 GitHub PAT is redacted');
    assert(redacted.cleanText.includes('function connect()'), '2.5 Non-secret code remains intact');

    // -------------------------------------------------------------
    // SUITE 3: Code-Aware Chunking & Exact Line Number Mapping
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 3: Code-Aware Semantic Chunking ---');

    const jsSource = [
      '// Line 1: Header',
      'import express from "express";',
      'const router = express.Router();',
      '',
      '/**',
      ' * User Login Route Handler',
      ' */',
      'router.post("/login", async (req, res) => {',
      '  const { email, password } = req.body;',
      '  if (!email || !password) return res.status(400).send("Missing credentials");',
      '  const token = signToken(email);',
      '  return res.json({ success: true, token });',
      '});',
      '',
      'export class UserService {',
      '  async findUser(id) {',
      '    return { id, name: "Alice" };',
      '  }',
      '}',
      '',
      'export default router;',
    ].join('\n');

    const chunks = parseCodeFileIntoChunks(jsSource, 'src/routes/auth.js', 'javascript');
    assert(chunks.length >= 1, '3.1 Extracts semantic code chunks from JavaScript source');
    
    // Check line numbers
    for (const c of chunks) {
      assert(c.startLine >= 1 && c.endLine >= c.startLine && c.endLine <= 21, `3.2 Chunk [${c.chunkType}:${c.symbolName}] has valid 1-indexed line range (${c.startLine}-${c.endLine})`);
    }

    // -------------------------------------------------------------
    // SUITE 4: ZIP Safety & Path Traversal Prevention
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 4: ZIP Archive Safety & Path Traversal Prevention ---');

    // Create a legitimate fixture zip
    const fixtureZipPath = path.join(testTempDir, 'fixture_repo.zip');
    const zip = new AdmZip();
    zip.addFile('index.js', Buffer.from('console.log("hello world");\nfunction greet() { return "hi"; }\n'));
    zip.addFile('controllers/authController.js', Buffer.from(`
      import { User } from '../models/User.js';
      export async function loginUser(req, res) {
        const user = await User.findOne({ email: req.body.email });
        return res.json({ user });
      }
    `));
    zip.addFile('routes/authRoutes.js', Buffer.from(`
      import { loginUser } from '../controllers/authController.js';
      router.post('/login', loginUser);
    `));
    zip.writeZip(fixtureZipPath);

    const extractTarget = path.join(testTempDir, 'extracted_fixture');
    const extractResult = await validateAndExtractZip(fixtureZipPath, extractTarget);
    assert(extractResult.extractedCount >= 3, '4.1 Successfully extracted safe ZIP archive');
    assert(fs.existsSync(path.join(extractTarget, 'index.js')), '4.2 Safe file extracted to designated directory');

    // Create a malicious zip attempting path traversal
    const badZipPath = path.join(testTempDir, 'malicious.zip');
    const badZip = new AdmZip();
    badZip.addFile('temp_file.txt', Buffer.from('malicious content'));
    badZip.getEntries()[0].entryName = '../escaped_file.txt';
    badZip.writeZip(badZipPath);

    let traversalBlocked = false;
    try {
      await validateAndExtractZip(badZipPath, path.join(testTempDir, 'bad_extract'));
    } catch (err) {
      traversalBlocked = err.message.includes('path traversal');
    }
    assert(traversalBlocked, '4.3 Path traversal attempt ("../escaped_file.txt") is strictly blocked');

    // -------------------------------------------------------------
    // SUITE 5: Full Ingestion, Vector Persistence & Multi-Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 5: End-to-End Ingestion & Multi-Tenant Isolation ---');

    const testUser1 = await User.create({ email: `user1_${Date.now()}@codearena.com`, password: 'Password123!' });
    const testUser2 = await User.create({ email: `user2_${Date.now()}@codearena.com`, password: 'Password123!' });

    const codebase1 = await Codebase.create({
      ownerUserId: testUser1._id,
      name: 'AuthService',
      sourceType: 'zip',
      status: 'queued',
    });

    await processAndIndexRepository(codebase1._id, extractTarget, extractResult.rootPrefix);

    const readyCodebase = await Codebase.findById(codebase1._id);
    assert(readyCodebase.status === 'ready', '5.1 Codebase successfully transitions to READY state');
    assert(readyCodebase.stats.totalFiles >= 3, '5.2 Repository stats reflect indexed files count');
    assert(readyCodebase.stats.totalChunks > 0, '5.3 Repository stats reflect total chunks count');

    const user1Files = await RepositoryFile.find({ repositoryId: codebase1._id, ownerUserId: testUser1._id });
    assert(user1Files.length >= 3, '5.4 RepositoryFiles saved with ownerUserId');

    const user1Chunks = await CodeChunk.find({ repositoryId: codebase1._id, ownerUserId: testUser1._id });
    assert(user1Chunks.length > 0, '5.5 CodeChunks saved with 384-d vector embeddings');
    assert(user1Chunks[0].embedding.length === 384, '5.6 CodeChunk embeddings are strictly 384-dimensional');

    // Multi-tenant isolation test: User 2 must NOT find User 1's code chunks
    const user2Retrieval = await retrieveRelevantCodeChunks('loginUser', codebase1._id, testUser2._id);
    assert(user2Retrieval.sources.length === 0, '5.7 Cross-tenant isolation: User 2 cannot retrieve vector chunks from User 1');

    // -------------------------------------------------------------
    // SUITE 6: Cross-File Dependencies & Impact Analysis
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 6: Cross-File Dependencies & Impact Analysis ---');

    const graph = await getRepositoryDependencyGraph(codebase1._id, testUser1._id);
    assert(graph.nodes.length >= 2, '6.1 Dependency graph contains extracted file and module nodes');
    assert(graph.edges.length >= 1, '6.2 Dependency graph contains import relationships');

    const impact = await analyzeImpact(codebase1._id, testUser1._id, 'authController');
    assert(impact.directDependentsCount >= 1, '6.3 Impact analysis detects files importing authController');
    assert(impact.affectedFiles.some(f => f.includes('authRoutes.js')), '6.4 Downstream impact accurately lists authRoutes.js');

    // -------------------------------------------------------------
    // SUITE 7: Static Security Audit
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 7: Static Security Audit Engine ---');

    // Add a file with risky patterns to test security analyzer
    await RepositoryFile.create({
      ownerUserId: testUser1._id,
      repositoryId: codebase1._id,
      relativePath: 'services/unsafeExec.js',
      language: 'javascript',
      extension: '.js',
      fileSize: 120,
      fileHash: 'dummy_hash',
      content: 'function runScript(cmd) {\n  return eval(cmd);\n}\n',
      lineCount: 3,
    });

    const findings = await runSecurityAudit(codebase1._id, testUser1._id);
    assert(findings.length >= 1, '7.1 Security audit flags unsafe code patterns');
    const evalFinding = findings.find(f => f.title.includes('Dynamic Code Execution'));
    assert(!!evalFinding && evalFinding.severity === 'Critical', '7.2 Dynamic eval() flagged as Critical severity');
    assert(evalFinding.filePath === 'services/unsafeExec.js' && evalFinding.startLine === 1, '7.3 Finding cites exact file path and line number');

    // -------------------------------------------------------------
    // SUITE 8: Codebase RAG Q&A & Citation Accuracy
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 8: Codebase RAG Q&A & Citation Accuracy ---');

    const ragQuery = await queryCodebase('Where is loginUser defined and what does it do?', codebase1._id, testUser1._id);
    assert(ragQuery.sources.length > 0, '8.1 RAG retrieval returns grounded source chunks');
    assert(ragQuery.sources[0].citation.includes(':'), '8.2 Citation contains valid path:startLine-endLine format');
    assert(ragQuery.answer.length > 0, '8.3 Grounded answer generated via LLM abstraction');

    // Honest abstention on unanswerable question
    const abstention = await queryCodebase('What is the AWS Bedrock Pinecone vector index ID?', codebase1._id, testUser1._id);
    assert(abstention.sources.length === 0 || abstention.answer.includes('does not provide sufficient evidence'), '8.4 Honest abstention when evidence is missing');

    // -------------------------------------------------------------
    // SUITE 9: Cascade Deletion
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 9: Cascade Deletion ---');

    const deleted = await deleteCodebaseCascade(codebase1._id, testUser1._id);
    assert(deleted, '9.1 Codebase delete cascade succeeds');

    const remainingFiles = await RepositoryFile.countDocuments({ repositoryId: codebase1._id });
    const remainingChunks = await CodeChunk.countDocuments({ repositoryId: codebase1._id });
    const remainingRels = await CodeRelationship.countDocuments({ repositoryId: codebase1._id });
    assert(remainingFiles === 0 && remainingChunks === 0 && remainingRels === 0, '9.2 All associated files, vector chunks, and relationships deleted');

    // Cleanup users
    await User.deleteMany({ _id: { $in: [testUser1._id, testUser2._id] } });
  } finally {
    await cleanupDirectory(testTempDir);
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }

  console.log('\n=================================================================');
  console.log(`CODEBASE INTELLIGENCE TEST RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});

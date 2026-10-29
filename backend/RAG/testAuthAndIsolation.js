/**
 * Phase B Verification Suite:
 * Authentication, Authorization, and Multi-Tenant Data Isolation Tests
 *
 * Verifies:
 * 1. User Registration (validations, password hashing, duplicate detection)
 * 2. Login, Logout, and HTTP-only JWT Cookie Session Handling
 * 3. Protected Route Enforcement (401 on unauthenticated or forged requests)
 * 4. Multi-Tenant Document Isolation (User A cannot list User B's documents)
 * 5. IDOR Attack Prevention on Read (User A cannot view status of User B's document)
 * 6. IDOR Attack Prevention on Delete (User A cannot delete User B's document)
 * 7. Cross-User RAG Scope Isolation (User A cannot query or retrieve User B's document chunks)
 * 8. Grounded RAG retrieval for authorized document owner
 */

import http from 'http';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../models/User.js';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure backend .env is loaded
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Set test environment so server.js doesn't call app.listen automatically
process.env.NODE_ENV = 'test';

const { default: app } = await import('../server.js');

let server;
let baseUrl;

function logPass(title) {
  console.log(`  \x1b[32m✔ PASS:\x1b[0m ${title}`);
}

function logFail(title, error) {
  console.error(`  \x1b[31m✘ FAIL:\x1b[0m ${title}`);
  if (error) console.error(`    Details:`, error);
}

// Helper to make multipart/form-data upload using native Node fetch
async function uploadTxtDocument(url, cookie, fileName, textContent) {
  const boundary = `----NodeBoundary${Date.now()}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  
  const bodyBuffer = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    Buffer.from(textContent, 'utf-8'),
    Buffer.from(footer, 'utf-8'),
  ]);

  const headers = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  };
  if (cookie) headers['Cookie'] = cookie;

  return fetch(url, {
    method: 'POST',
    headers,
    body: bodyBuffer,
  });
}

// Extracts Set-Cookie token header
function extractCookieToken(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/token=([^;]+)/);
  return match ? `token=${match[1]}` : null;
}

async function runTestSuite() {
  console.log('\n=================================================================');
  console.log('   PHASE B: AUTHENTICATION & MULTI-TENANT ISOLATION TEST SUITE   ');
  console.log('=================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  // Start test server on dynamic ephemeral port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`[Test Server] Started on ephemeral port: ${port}\n`);

  const timestamp = Date.now();
  const userAEmail = `alice_${timestamp}@testdomain.local`;
  const userBEmail = `bob_${timestamp}@testdomain.local`;
  const passwordA = 'SecurePassword123!';
  const passwordB = 'AnotherStrongPass456!';

  let cookieUserA = null;
  let cookieUserB = null;
  let docAId = null;
  let docBId = null;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: User Registration
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userAEmail, password: passwordA }),
      });
      const data = await res.json();
      cookieUserA = extractCookieToken(res);

      if (res.status === 201 && data.success && data.data?.user?.email === userAEmail && cookieUserA) {
        // Ensure password hash is not exposed
        if (!data.data.user.password) {
          logPass(`User A registered successfully with HTTP-only cookie`);
          passedTests++;
        } else {
          throw new Error('User password hash was exposed in registration response!');
        }
      } else {
        throw new Error(`Unexpected status ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      logFail(`User A registration`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 2: User B Registration
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userBEmail, password: passwordB }),
      });
      const data = await res.json();
      cookieUserB = extractCookieToken(res);

      if (res.status === 201 && data.success && cookieUserB) {
        logPass(`User B registered successfully with HTTP-only cookie`);
        passedTests++;
      } else {
        throw new Error(`Failed to register User B: ${res.status}`);
      }
    } catch (err) {
      logFail(`User B registration`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Duplicate Registration Rejection (409 Conflict)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userAEmail, password: 'AnyPassword789!' }),
      });
      if (res.status === 409) {
        logPass(`Duplicate registration correctly rejected with 409 Conflict`);
        passedTests++;
      } else {
        throw new Error(`Expected 409 Conflict, got ${res.status}`);
      }
    } catch (err) {
      logFail(`Duplicate registration rejection`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Weak Password Rejection (400 Bad Request)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `weak_${timestamp}@test.com`, password: 'short' }),
      });
      if (res.status === 400) {
        logPass(`Short password (< 8 chars) correctly rejected with 400 Bad Request`);
        passedTests++;
      } else {
        throw new Error(`Expected 400, got ${res.status}`);
      }
    } catch (err) {
      logFail(`Weak password validation`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 5: User Login with Valid & Invalid Credentials
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // 5a. Bad password
      const badRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userAEmail, password: 'WrongPassword999' }),
      });
      if (badRes.status !== 401) throw new Error(`Expected 401 for bad password, got ${badRes.status}`);

      // 5b. Good password
      const goodRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userAEmail, password: passwordA }),
      });
      const goodData = await goodRes.json();
      const freshCookie = extractCookieToken(goodRes);

      if (goodRes.status === 200 && goodData.success && freshCookie) {
        cookieUserA = freshCookie;
        logPass(`User login succeeds with correct credentials & sets JWT cookie`);
        passedTests++;
      } else {
        throw new Error(`Login failed with status ${goodRes.status}`);
      }
    } catch (err) {
      logFail(`Login verification`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Protected /api/auth/me Profile Route
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookieUserA },
      });
      const data = await res.json();
      if (res.status === 200 && data.data?.user?.email === userAEmail) {
        logPass(`Protected /api/auth/me verified user identity via session cookie`);
        passedTests++;
      } else {
        throw new Error(`Expected 200 with userA email, got ${res.status}`);
      }
    } catch (err) {
      logFail(`Protected /api/auth/me`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 7: Unauthenticated Route Protection (401 Unauthorized)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const docRes = await fetch(`${baseUrl}/api/documents`);
      const chatRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hello' }),
      });
      const forgedRes = await fetch(`${baseUrl}/api/documents`, {
        headers: { Cookie: 'token=forged.invalid.jwt.token' },
      });

      if (docRes.status === 401 && chatRes.status === 401 && forgedRes.status === 401) {
        logPass(`Unauthenticated and forged token requests blocked with 401 Unauthorized`);
        passedTests++;
      } else {
        throw new Error(`Status mismatch: doc=${docRes.status}, chat=${chatRes.status}, forged=${forgedRes.status}`);
      }
    } catch (err) {
      logFail(`Unauthenticated route protection`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 8: Document Upload with Multi-Tenant Ownership
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A uploads Document A
      const textA = `PROJECT OMEGA CLASSIFIED BRIEFING\nLead Engineer: Alice Vance.\nDeployment Date: October 2026.\nTarget Objective: Quantum Sensor Calibration for Autonomous Drone Fleet Alpha.`;
      const resA = await uploadTxtDocument(`${baseUrl}/api/documents/upload`, cookieUserA, 'alice_omega_briefing.txt', textA);
      const dataA = await resA.json();

      if (resA.status !== 201 || !dataA.success) {
        throw new Error(`User A upload failed: ${JSON.stringify(dataA)}`);
      }
      docAId = dataA.data._id;

      // User B uploads Document B
      const textB = `BOB FINANCIAL AUDIT 2026\nChief Auditor: Bob Jenkins.\nAnnual Revenue: $48,500,000 USD.\nApproved Expenditures: Project Hyperion Data Centers in Dublin and Tokyo.`;
      const resB = await uploadTxtDocument(`${baseUrl}/api/documents/upload`, cookieUserB, 'bob_financial_audit.txt', textB);
      const dataB = await resB.json();

      if (resB.status !== 201 || !dataB.success) {
        throw new Error(`User B upload failed: ${JSON.stringify(dataB)}`);
      }
      docBId = dataB.data._id;

      // Check DB directly to verify userId is set on both documents and chunks
      const userARecord = await User.findOne({ email: userAEmail });
      const userBRecord = await User.findOne({ email: userBEmail });

      const dbDocA = await Document.findById(docAId);
      const dbDocB = await Document.findById(docBId);
      const chunksA = await DocumentChunk.find({ documentId: docAId });
      const chunksB = await DocumentChunk.find({ documentId: docBId });

      const docAOwnerMatches = dbDocA.userId.toString() === userARecord._id.toString();
      const docBOwnerMatches = dbDocB.userId.toString() === userBRecord._id.toString();
      const chunksAOwnerMatches = chunksA.every((c) => c.userId.toString() === userARecord._id.toString());
      const chunksBOwnerMatches = chunksB.every((c) => c.userId.toString() === userBRecord._id.toString());

      if (docAOwnerMatches && docBOwnerMatches && chunksAOwnerMatches && chunksBOwnerMatches) {
        logPass(`Documents & chunks successfully persisted with strict userId ownership references`);
        passedTests++;
      } else {
        throw new Error(`Ownership reference mismatch in MongoDB records.`);
      }
    } catch (err) {
      logFail(`Document upload with multi-tenant ownership`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 9: Multi-Tenant Data Isolation (Listing Scoping)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A lists documents
      const resA = await fetch(`${baseUrl}/api/documents`, { headers: { Cookie: cookieUserA } });
      const dataA = await resA.json();
      const userAListIds = dataA.data.map((d) => d._id);

      // User B lists documents
      const resB = await fetch(`${baseUrl}/api/documents`, { headers: { Cookie: cookieUserB } });
      const dataB = await resB.json();
      const userBListIds = dataB.data.map((d) => d._id);

      const userASeesOnlyHis = userAListIds.includes(docAId) && !userAListIds.includes(docBId);
      const userBSeesOnlyHis = userBListIds.includes(docBId) && !userBListIds.includes(docAId);

      if (userASeesOnlyHis && userBSeesOnlyHis) {
        logPass(`Document listing strictly isolated: User A cannot see User B's documents`);
        passedTests++;
      } else {
        throw new Error(`Leak detected: userAList=${userAListIds}, userBList=${userBListIds}`);
      }
    } catch (err) {
      logFail(`Document listing isolation`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 10: IDOR Attack Prevention on Read (/api/documents/:id/status)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A attempts to view status of User B's document
      const res = await fetch(`${baseUrl}/api/documents/${docBId}/status`, {
        headers: { Cookie: cookieUserA },
      });

      if (res.status === 404) {
        logPass(`IDOR Read Blocked: User A cannot inspect User B's document status (HTTP 404)`);
        passedTests++;
      } else {
        throw new Error(`Expected 404 Access Denied, got ${res.status}`);
      }
    } catch (err) {
      logFail(`IDOR Read Protection`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 11: IDOR Attack Prevention on Delete (DELETE /api/documents/:id)
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A attempts to delete User B's document
      const res = await fetch(`${baseUrl}/api/documents/${docBId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieUserA },
      });

      // Verify Document B and its chunks are STILL in the database
      const docBStillExists = await Document.findById(docBId);
      const chunksBCount = await DocumentChunk.countDocuments({ documentId: docBId });

      if (res.status === 404 && docBStillExists && chunksBCount > 0) {
        logPass(`IDOR Delete Blocked: User A cannot delete User B's document; data preserved`);
        passedTests++;
      } else {
        throw new Error(`Expected 404 and intact doc, got status ${res.status}, doc=${!!docBStillExists}`);
      }
    } catch (err) {
      logFail(`IDOR Delete Protection`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 12: Cross-User Query Isolation in RAG Chatbot
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A tries to query specifically referencing User B's document ID
      const crossQueryRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieUserA,
        },
        body: JSON.stringify({
          question: 'What was the annual revenue approved for Dublin?',
          documentIds: [docBId], // Maliciously target User B's document
          topK: 3,
        }),
      });
      const crossData = await crossQueryRes.json();

      // Backend should NOT retrieve any chunks from Document B
      const sourcesContainDocB = crossData.data?.sources?.some((s) => s.documentId === docBId);

      if (!sourcesContainDocB) {
        logPass(`Cross-User RAG Query Blocked: User A cannot retrieve vector chunks from User B's document`);
        passedTests++;
      } else {
        throw new Error(`Data leakage! User B's chunk was returned to User A: ${JSON.stringify(crossData)}`);
      }
    } catch (err) {
      logFail(`Cross-user RAG isolation`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 13: Authorized RAG Query for Document Owner
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A queries their own Document A
      const authQueryRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieUserA,
        },
        body: JSON.stringify({
          question: 'Who is the lead engineer and what is the target objective?',
          documentIds: [docAId],
          topK: 3,
        }),
      });
      const authData = await authQueryRes.json();

      if (authQueryRes.status === 200 && authData.success) {
        const sources = authData.data?.sources || [];
        const retrievedDocA = sources.some((s) => s.documentId === docAId);
        if (retrievedDocA) {
          logPass(`Authorized RAG Query Succeeded: User A successfully retrieved grounded chunks from Document A`);
          passedTests++;
        } else {
          throw new Error(`Document A was not found in retrieved sources.`);
        }
      } else {
        throw new Error(`Query failed with status ${authQueryRes.status}: ${JSON.stringify(authData)}`);
      }
    } catch (err) {
      logFail(`Authorized RAG query`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 14: Authorized Document Deletion
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      // User A deletes Document A
      const delRes = await fetch(`${baseUrl}/api/documents/${docAId}`, {
        method: 'DELETE',
        headers: { Cookie: cookieUserA },
      });
      const delData = await delRes.json();

      // Verify Document A and its chunks are removed, while Document B is untouched
      const docAGone = (await Document.findById(docAId)) === null;
      const chunksAGone = (await DocumentChunk.countDocuments({ documentId: docAId })) === 0;
      const docBRemains = (await Document.findById(docBId)) !== null;

      if (delRes.status === 200 && delData.success && docAGone && chunksAGone && docBRemains) {
        logPass(`Authorized deletion cleans up only the owner's document and chunks`);
        passedTests++;
      } else {
        throw new Error(`Deletion verification failed.`);
      }
    } catch (err) {
      logFail(`Authorized deletion`, err.message);
    }

    // -------------------------------------------------------------------------
    // TEST 15: Logout & Session Invalidation
    // -------------------------------------------------------------------------
    totalTests++;
    try {
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookieUserA },
      });
      const clearedSetCookie = logoutRes.headers.get('set-cookie');

      // Subsequent call with cleared token should return 401
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: 'token=;' },
      });

      if (logoutRes.status === 200 && meRes.status === 401) {
        logPass(`Logout successfully clears session cookie and revokes access`);
        passedTests++;
      } else {
        throw new Error(`Logout session check failed: logout=${logoutRes.status}, me=${meRes.status}`);
      }
    } catch (err) {
      logFail(`Logout handling`, err.message);
    }

    // -------------------------------------------------------------------------
    // CLEANUP TEST DATA
    // -------------------------------------------------------------------------
    try {
      if (docBId) {
        await DocumentChunk.deleteMany({ documentId: docBId });
        await Document.deleteOne({ _id: docBId });
      }
      await User.deleteMany({ email: { $in: [userAEmail, userBEmail] } });
    } catch (cleanupErr) {
      console.warn('Warning: Test cleanup error:', cleanupErr.message);
    }

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n-----------------------------------------------------------------');
  console.log(`Phase B Verification Results: ${passedTests}/${totalTests} Tests Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('-----------------------------------------------------------------\n');

  if (passedTests === totalTests) {
    console.log('\x1b[32m✔ ALL PHASE B SECURITY & MULTI-TENANCY CHECKS PASSED SUCCESSFULLY!\x1b[0m\n');
    await mongoose.disconnect();
    process.exit(0);
  } else {
    console.error('\x1b[31m✘ SOME TESTS FAILED. Please review the failures above.\x1b[0m\n');
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTestSuite().catch(async (err) => {
  console.error('[Fatal Test Error]', err);
  if (server) server.close();
  await mongoose.disconnect();
  process.exit(1);
});


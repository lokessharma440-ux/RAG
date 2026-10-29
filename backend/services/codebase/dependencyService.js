import path from 'path';
import { CodeRelationship } from '../../models/CodeRelationship.js';

/**
 * Extracts observable cross-file relationships from a single code file.
 *
 * @param {string} relativePath - Source file path.
 * @param {string} content - Source text.
 * @param {string} language - Code language.
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @returns {Array<Object>} List of relationship objects to insert.
 */
export function extractFileRelationships(relativePath, content, language, repositoryId, ownerUserId) {
  const relationships = [];
  const lines = content.split('\n');
  const dirName = path.dirname(relativePath);

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i].trim();

    // 1. JavaScript / TypeScript ES Imports and CommonJS require
    if (['javascript', 'typescript'].includes(language)) {
      // import ... from './path.js'
      const importMatch = line.match(/(?:import\s+(?:(?:{[^}]+}|\*\s+as\s+[A-Za-z0-9_$]+|[A-Za-z0-9_$]+)\s+from\s+)?|require\s*\(\s*)['"`]([^'"`]+)['"`]/);
      if (importMatch && importMatch[1]) {
        const rawImportPath = importMatch[1];
        if (rawImportPath.startsWith('.')) {
          // Resolve relative path
          const resolvedTarget = path.normalize(path.join(dirName, rawImportPath)).replace(/\\/g, '/');
          relationships.push({
            ownerUserId,
            repositoryId,
            sourcePath: relativePath,
            targetPath: resolvedTarget,
            relationType: 'imports',
            symbol: rawImportPath.split('/').pop(),
            lineNumber: lineNum,
          });
        }
      }

      // 2. API Route Registration
      const routeMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i);
      if (routeMatch) {
        relationships.push({
          ownerUserId,
          repositoryId,
          sourcePath: relativePath,
          targetPath: null,
          relationType: 'defines_route',
          symbol: `${routeMatch[1].toUpperCase()} ${routeMatch[2]}`,
          lineNumber: lineNum,
        });
      }

      // 3. Database Model Usage
      const modelMatch = line.match(/\b([A-Z][a-zA-Z0-9]+)\.(find|findOne|findById|create|updateOne|deleteOne|aggregate)\b/);
      if (modelMatch) {
        relationships.push({
          ownerUserId,
          repositoryId,
          sourcePath: relativePath,
          targetPath: null,
          relationType: 'uses_model',
          symbol: `${modelMatch[1]}.${modelMatch[2]}`,
          lineNumber: lineNum,
        });
      }
    } else if (language === 'python') {
      // Python imports: from .module import something OR import module
      const pyImport = line.match(/(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/);
      if (pyImport) {
        const mod = pyImport[1] || pyImport[2];
        relationships.push({
          ownerUserId,
          repositoryId,
          sourcePath: relativePath,
          targetPath: mod.replace(/\./g, '/'),
          relationType: 'imports',
          symbol: mod,
          lineNumber: lineNum,
        });
      }
    }
  }

  return relationships;
}

/**
 * Builds a visual graph of repository relationships (nodes & edges).
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @returns {Promise<{ nodes: Array<Object>, edges: Array<Object>, totalRelationships: number }>}
 */
export async function getRepositoryDependencyGraph(repositoryId, ownerUserId) {
  const relations = await CodeRelationship.find({
    repositoryId,
    ownerUserId,
  }).limit(500);

  const nodeMap = new Map();
  const edges = [];

  for (const rel of relations) {
    // Add source node
    if (!nodeMap.has(rel.sourcePath)) {
      nodeMap.set(rel.sourcePath, {
        id: rel.sourcePath,
        label: rel.sourcePath.split('/').pop(),
        path: rel.sourcePath,
        type: rel.sourcePath.includes('route') ? 'route' : rel.sourcePath.includes('model') ? 'model' : 'file',
      });
    }

    // Add target node if available
    if (rel.targetPath && !nodeMap.has(rel.targetPath)) {
      nodeMap.set(rel.targetPath, {
        id: rel.targetPath,
        label: rel.targetPath.split('/').pop(),
        path: rel.targetPath,
        type: 'file',
      });
    }

    edges.push({
      id: `${rel._id}`,
      source: rel.sourcePath,
      target: rel.targetPath || rel.symbol,
      type: rel.relationType,
      symbol: rel.symbol,
      lineNumber: rel.lineNumber,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    totalRelationships: relations.length,
  };
}

/**
 * Performs downstream impact analysis for a changed file or symbol.
 *
 * @param {string} repositoryId
 * @param {string} ownerUserId
 * @param {string} target - File path or symbol name
 * @returns {Promise<Object>} Impact analysis report
 */
export async function analyzeImpact(repositoryId, ownerUserId, target) {
  const cleanTarget = (target || '').trim();
  if (!cleanTarget) {
    throw new Error('A target file path or symbol name is required for impact analysis.');
  }

  // Find all files that import or reference this target
  const directDependents = await CodeRelationship.find({
    repositoryId,
    ownerUserId,
    $or: [
      { targetPath: { $regex: cleanTarget, $options: 'i' } },
      { symbol: { $regex: cleanTarget, $options: 'i' } },
    ],
  });

  const affectedFiles = new Set();
  const affectedRoutes = [];
  const affectedModels = [];

  for (const rel of directDependents) {
    affectedFiles.add(rel.sourcePath);
    if (rel.relationType === 'defines_route') {
      affectedRoutes.push({ route: rel.symbol, file: rel.sourcePath, line: rel.lineNumber });
    } else if (rel.relationType === 'uses_model') {
      affectedModels.push({ model: rel.symbol, file: rel.sourcePath, line: rel.lineNumber });
    }
  }

  // Compute risk level
  let riskLevel = 'Low';
  if (affectedFiles.size > 5 || affectedRoutes.length > 0) riskLevel = 'High';
  else if (affectedFiles.size > 1) riskLevel = 'Medium';

  return {
    target: cleanTarget,
    riskLevel,
    directDependentsCount: affectedFiles.size,
    affectedFiles: Array.from(affectedFiles),
    affectedRoutes,
    affectedModels,
    summary: `Modifying "${cleanTarget}" directly impacts ${affectedFiles.size} downstream file(s)${affectedRoutes.length ? ` and ${affectedRoutes.length} exposed API route(s)` : ''}.`,
  };
}

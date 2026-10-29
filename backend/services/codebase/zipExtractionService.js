import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export const ZIP_LIMITS = {
  MAX_ARCHIVE_BYTES: parseInt(process.env.MAX_ZIP_UPLOAD_BYTES, 10) || 25 * 1024 * 1024, // 25 MB
  MAX_EXTRACTED_BYTES: parseInt(process.env.MAX_EXTRACTED_BYTES, 10) || 100 * 1024 * 1024, // 100 MB
  MAX_ENTRIES: parseInt(process.env.MAX_ARCHIVE_FILES, 10) || 2500, // 2500 files
  MAX_EXPANSION_RATIO: 20, // 20x
  MAX_NESTING_DEPTH: 10,
};

/**
 * Safely removes a directory and all its contents recursively.
 *
 * @param {string} dirPath
 */
export async function cleanupDirectory(dirPath) {
  if (!dirPath) return;
  try {
    if (fs.existsSync(dirPath)) {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[Cleanup Warning] Could not remove directory ${dirPath}:`, err.message);
  }
}

/**
 * Validates a zip archive against path traversal, zip bombs, and size limits,
 * then extracts it into an isolated target directory.
 *
 * @param {string} zipFilePath
 * @param {string} extractToDir
 * @returns {Promise<{ extractedCount: number, totalBytes: number, rootPrefix: string }>}
 */
export async function validateAndExtractZip(zipFilePath, extractToDir) {
  if (!fs.existsSync(zipFilePath)) {
    throw new Error('Archive file does not exist on disk.');
  }

  const fileStats = await fs.promises.stat(zipFilePath);
  if (fileStats.size > ZIP_LIMITS.MAX_ARCHIVE_BYTES) {
    throw new Error(`Archive exceeds maximum allowed size of ${Math.round(ZIP_LIMITS.MAX_ARCHIVE_BYTES / (1024 * 1024))}MB.`);
  }

  let zip;
  try {
    zip = new AdmZip(zipFilePath);
  } catch (err) {
    throw new Error(`Invalid or corrupted ZIP archive: ${err.message}`);
  }

  const entries = zip.getEntries();

  if (entries.length === 0) {
    throw new Error('The uploaded ZIP archive is completely empty.');
  }

  if (entries.length > ZIP_LIMITS.MAX_ENTRIES) {
    throw new Error(`Archive contains ${entries.length} entries, exceeding maximum allowed limit of ${ZIP_LIMITS.MAX_ENTRIES} files.`);
  }

  let totalUncompressedBytes = 0;
  const canonicalTargetDir = path.resolve(extractToDir);

  // Pre-validate all entries before writing a single byte to disk
  for (const entry of entries) {
    const entryName = entry.entryName;

    // 1. Path Traversal Defense (Check for .. and absolute paths)
    if (entryName.includes('..') || path.isAbsolute(entryName)) {
      throw new Error(`Security Violation: Archive contains malicious path traversal entry "${entryName}".`);
    }

    // Check for Windows drive letters or null bytes
    if (/^[A-Za-z]:/i.test(entryName) || entryName.includes('\0')) {
      throw new Error(`Security Violation: Archive contains invalid filename "${entryName}".`);
    }

    const resolvedPath = path.resolve(canonicalTargetDir, entryName);
    if (!resolvedPath.startsWith(canonicalTargetDir + path.sep) && resolvedPath !== canonicalTargetDir) {
      throw new Error(`Security Violation: Archive entry escapes destination root directory.`);
    }

    // 2. Check directory nesting depth
    const depth = entryName.split(/[/\\]/).filter(Boolean).length;
    if (depth > ZIP_LIMITS.MAX_NESTING_DEPTH) {
      throw new Error(`Archive exceeds maximum allowed nesting depth of ${ZIP_LIMITS.MAX_NESTING_DEPTH} levels.`);
    }

    // 3. Size accumulation and zip bomb guard
    totalUncompressedBytes += entry.header.size;

    if (totalUncompressedBytes > ZIP_LIMITS.MAX_EXTRACTED_BYTES) {
      throw new Error(`Archive uncompressed content exceeds size limit of ${Math.round(ZIP_LIMITS.MAX_EXTRACTED_BYTES / (1024 * 1024))}MB.`);
    }
  }

  // Expansion ratio check
  if (fileStats.size > 0) {
    const ratio = totalUncompressedBytes / fileStats.size;
    if (ratio > ZIP_LIMITS.MAX_EXPANSION_RATIO && totalUncompressedBytes > 10 * 1024 * 1024) {
      throw new Error(`Suspicious archive compression ratio (${ratio.toFixed(1)}x) exceeds security threshold.`);
    }
  }

  // Create isolated target directory
  if (!fs.existsSync(canonicalTargetDir)) {
    await fs.promises.mkdir(canonicalTargetDir, { recursive: true });
  }

  // Extract all entries safely
  zip.extractAllTo(canonicalTargetDir, true);

  // Detect root folder prefix if GitHub or tool wrapped repository in a single top-level folder
  let rootPrefix = '';
  const dirContents = await fs.promises.readdir(canonicalTargetDir);
  if (dirContents.length === 1) {
    const singleItem = path.join(canonicalTargetDir, dirContents[0]);
    const stat = await fs.promises.stat(singleItem);
    if (stat.isDirectory()) {
      rootPrefix = dirContents[0];
    }
  }

  return {
    extractedCount: entries.filter((e) => !e.isDirectory).length,
    totalBytes: totalUncompressedBytes,
    rootPrefix,
  };
}

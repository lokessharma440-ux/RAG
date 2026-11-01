/**
 * Safe Legacy Document Migration Script
 *
 * Inspects existing MongoDB documents and safely manages unassigned legacy records.
 * NEVER deletes data.
 *
 * Usage:
 *   node backend/scripts/migrateLegacyDocuments.js --status
 *   node backend/scripts/migrateLegacyDocuments.js --assign-to user@example.com
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mern_dev_db';

async function runMigration() {
  console.log('='.repeat(65));
  console.log('   MERN RAG SAFE LEGACY DATA MIGRATION UTILITY');
  console.log('='.repeat(65));

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}`);

  const db = mongoose.connection.db;
  const docsColl = db.collection('documents');
  const chunksColl = db.collection('documentchunks');
  const usersColl = db.collection('users');

  const args = process.argv.slice(2);
  const assignIndex = args.findIndex((arg) => arg === '--assign-to' || arg === '--assign');
  const targetEmail = assignIndex !== -1 ? args[assignIndex + 1] : null;

  // 1. Fetch current document statistics
  const totalDocs = await docsColl.countDocuments();
  const unassignedDocs = await docsColl.find({
    $or: [{ userId: null }, { userId: { $exists: false } }],
  }).toArray();
  const assignedDocsCount = totalDocs - unassignedDocs.length;
  const totalChunks = await chunksColl.countDocuments();
  const unassignedChunksCount = await chunksColl.countDocuments({
    $or: [{ userId: null }, { userId: { $exists: false } }],
  });

  console.log(`\n[Database Inventory]`);
  console.log(`  Total Documents in DB:     ${totalDocs}`);
  console.log(`  Assigned Documents:        ${assignedDocsCount}`);
  console.log(`  Unassigned Legacy Docs:    ${unassignedDocs.length}`);
  console.log(`  Total Chunks in DB:        ${totalChunks}`);
  console.log(`  Unassigned Legacy Chunks:  ${unassignedChunksCount}`);

  if (unassignedDocs.length > 0) {
    console.log(`\n[Unassigned Legacy Documents List]`);
    unassignedDocs.forEach((doc, idx) => {
      console.log(`  ${idx + 1}. ID: ${doc._id} | Name: "${doc.originalName}" | Chunks: ${doc.chunkCount || 0} | Status: ${doc.status}`);
    });
  }

  // 2. Perform assignment if targetEmail provided
  if (targetEmail) {
    console.log(`\n[Action: Assign Legacy Data to User: ${targetEmail}]`);

    const user = await usersColl.findOne({ email: targetEmail.trim().toLowerCase() });
    if (!user) {
      console.error(`\n[Error] User with email "${targetEmail}" was not found in the database.`);
      console.error(`Please register the user first, then run this migration command.`);
      await mongoose.disconnect();
      process.exit(1);
    }

    if (unassignedDocs.length === 0) {
      console.log(`\n[Info] No unassigned documents found. Nothing to migrate.`);
      await mongoose.disconnect();
      return;
    }

    const unassignedDocIds = unassignedDocs.map((d) => d._id);

    // Update documents
    const docUpdateResult = await docsColl.updateMany(
      { _id: { $in: unassignedDocIds } },
      { $set: { userId: user._id } }
    );

    // Update corresponding chunks
    const chunkUpdateResult = await chunksColl.updateMany(
      { documentId: { $in: unassignedDocIds } },
      { $set: { userId: user._id } }
    );

    console.log(`\n[Migration Results]`);
    console.log(`  Successfully assigned ${docUpdateResult.modifiedCount} documents to user ${user.email} (${user._id}).`);
    console.log(`  Successfully assigned ${chunkUpdateResult.modifiedCount} chunks to user ${user.email} (${user._id}).`);
  } else {
    console.log(`\n[Migration Plan Summary]`);
    console.log(`  Status Mode: No database modifications made.`);
    console.log(`  To assign unassigned documents to a verified user account, run:`);
    console.log(`  node backend/scripts/migrateLegacyDocuments.js --assign-to <user_email>\n`);
  }

  await mongoose.disconnect();
  console.log('='.repeat(65));
}

runMigration().catch((err) => {
  console.error('[Migration Error]', err);
  mongoose.disconnect();
  process.exit(1);
});

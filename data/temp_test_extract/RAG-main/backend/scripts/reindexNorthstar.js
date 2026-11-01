import mongoose from 'mongoose';
import { Document } from '../models/Document.js';
import { reindexDocument } from '../services/documentService.js';

await mongoose.connect('mongodb://127.0.0.1:27017/mern_dev_db');

const doc = await Document.findOne({ originalName: 'Northstar_Community_Learning_Hub_Report.txt' });
if (!doc) {
  console.log('Document not found in database.');
} else {
  console.log(`Found Northstar document (ID: ${doc._id}), currently with ${doc.chunkCount} chunks.`);
  console.log('Re-indexing with structure-aware chunker...');
  const reindexed = await reindexDocument(doc._id.toString(), doc.userId);
  console.log(`✓ Re-indexed successfully! New chunkCount: ${reindexed.chunkCount}, Status: ${reindexed.status}`);
}

await mongoose.disconnect();


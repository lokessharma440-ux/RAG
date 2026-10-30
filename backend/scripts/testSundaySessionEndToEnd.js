import mongoose from 'mongoose';
import { Document } from '../models/Document.js';
import { queryDocumentRAG } from '../services/documentService.js';

await mongoose.connect('mongodb://127.0.0.1:27017/mern_dev_db');

const doc = await Document.findOne({ originalName: 'Northstar_Community_Learning_Hub_Report.txt' });
const question = "How many participants attended every Sunday session during the pilot?";

console.log('Executing queryDocumentRAG for Sunday session question...');
const result = await queryDocumentRAG(question, [doc._id.toString()], 5, doc.userId);

console.log('\n======================================================');
console.log('                 RETRIEVED SOURCES');
console.log('======================================================');
result.sources.forEach((s, idx) => {
  console.log(`\nSource ${idx + 1}: Chunk ${s.chunkIndex} | Score: ${s.score.toFixed(4)}`);
  console.log('Text snippet:', s.text.slice(0, 160).replace(/\n/g, ' '));
});

console.log('\n======================================================');
console.log('                 SYNTHESIZED ANSWER');
console.log('======================================================');
console.log(result.answer);

await mongoose.disconnect();

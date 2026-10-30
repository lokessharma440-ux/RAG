import mongoose from 'mongoose';
import { Document } from '../models/Document.js';
import { queryDocumentRAG } from '../services/documentService.js';

await mongoose.connect('mongodb://127.0.0.1:27017/mern_dev_db');

const doc = await Document.findOne({ originalName: 'Northstar_Community_Learning_Hub_Report.txt' });
const question = "Among the three time-limited programmes, which programme had the highest completion rate? Calculate its completion rate to one decimal place. Then compare it with Northstar's overall completion rate of 74.7% and state the difference in percentage points. Use only the figures provided in the report.";

console.log('Executing queryDocumentRAG for Northstar question...');
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

// Check calculations:
const ansLower = result.answer.toLowerCase();
const hasDF = ansLower.includes('digital foundations');
const has77_5 = result.answer.includes('77.5');
const has70 = result.answer.includes('70.0') || result.answer.includes('70%');
const has75 = result.answer.includes('75.0') || result.answer.includes('75%');
const has2_8 = result.answer.includes('2.8');
const mentionsPercentagePoints = ansLower.includes('percentage point');

console.log('\n--- VERIFICATION CHECKS ---');
console.log('Digital Foundations identified as highest:', hasDF);
console.log('Digital Foundations 77.5% present:', has77_5);
console.log('Code Pathways 70.0% present:', has70);
console.log('Career Launch 75.0% present:', has75);
console.log('Difference 2.8 percentage points present:', has2_8 && mentionsPercentagePoints);

await mongoose.disconnect();

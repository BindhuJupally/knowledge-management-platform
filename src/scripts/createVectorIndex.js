require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { ensureVectorIndex, getVectorSearchIndex, VECTOR_INDEX_NAME } = require('../services/vectorIndex.service');

async function run() {
  try {
    await connectDB();
    console.log(`[VectorIndex] Checking vector index '${VECTOR_INDEX_NAME}' on 'chunks' collection...`);

    const result = await ensureVectorIndex();
    console.log(`[VectorIndex] Status: ${result.status} (Created: ${result.created})`);

    const indexInfo = await getVectorSearchIndex(VECTOR_INDEX_NAME);
    if (indexInfo) {
      console.log(`[VectorIndex] Index details:`, JSON.stringify(indexInfo, null, 2));
    }

    console.log('[VectorIndex] Done.');
  } catch (error) {
    console.error(`[VectorIndex] Failed: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run();
}

module.exports = run;

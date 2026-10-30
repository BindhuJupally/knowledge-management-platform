require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { ensureVectorIndex, VECTOR_INDEX_NAME } = require('./services/vectorIndex.service');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();

    // Verify or ensure Atlas Vector Search index on startup
    try {
      const idxResult = await ensureVectorIndex();
      console.log(`[VectorIndex] '${VECTOR_INDEX_NAME}' is ${idxResult.status}`);
    } catch (idxErr) {
      console.warn(`[VectorIndex] Index check warning: ${idxErr.message}`);
    }

    app.listen(PORT, () => {
      console.log(`[Server] Knowledge Management Platform running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`[Server] Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

startServer();

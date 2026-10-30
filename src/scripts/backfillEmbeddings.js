// Load .env before any module that reads process.env at require-time
require('dotenv').config();

const mongoose = require('mongoose');
const Chunk = require('../models/Chunk');
const embeddingService = require('../services/embedding.service');
const connectDB = require('../config/db');

/**
 * Check if a chunk already has a completely valid, up-to-date embedding
 * @param {object} chunk
 * @param {object} modelInfo
 * @returns {boolean}
 */
function isEmbeddingValidAndCurrent(chunk, modelInfo) {
  if (
    !chunk.embedding ||
    !Array.isArray(chunk.embedding) ||
    chunk.embedding.length !== modelInfo.dimension ||
    chunk.embeddingModel !== modelInfo.model ||
    chunk.embeddingVersion !== modelInfo.version
  ) {
    return false;
  }

  try {
    embeddingService.validateEmbeddingVector(chunk.embedding, modelInfo.dimension);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Backfill embeddings for chunks in MongoDB
 * Identifies missing, outdated, wrong-dimension, or malformed embeddings.
 *
 * @param {object} options
 * @param {string} [options.tenantId] - Optional tenantId to filter by
 * @param {number} [options.batchSize=32] - Batch size for processing
 * @param {boolean} [options.force=false] - If true, re-embed chunks even if they already have embeddings
 * @returns {Promise<{ totalFound: number, processed: number, skipped: number, failed: number, model: string }>}
 */
async function backfillEmbeddings({ tenantId, batchSize = 32, force = false } = {}) {
  const modelInfo = embeddingService.getModelInfo();
  const query = {};

  if (tenantId) {
    query.tenantId = tenantId;
  }

  if (!force) {
    query.$or = [
      { embedding: { $exists: false } },
      { embedding: null },
      { embedding: { $size: 0 } },
      { embeddingModel: { $ne: modelInfo.model } },
      { embeddingVersion: { $ne: modelInfo.version } },
      { embedding: { $not: { $size: modelInfo.dimension } } },
    ];
  }

  const totalFound = await Chunk.countDocuments(query);
  console.log(`[Backfill] Found ${totalFound} chunk(s) eligible for embedding backfill.`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  const cursor = Chunk.find(query).batchSize(batchSize).cursor();
  let batch = [];

  for await (const doc of cursor) {
    // If not force mode, verify whether doc actually needs re-embedding
    if (!force && isEmbeddingValidAndCurrent(doc, modelInfo)) {
      skipped++;
      continue;
    }

    batch.push(doc);

    if (batch.length >= batchSize) {
      const stats = await processBatch(batch, modelInfo);
      processed += stats.processed;
      skipped += stats.skipped;
      failed += stats.failed;
      batch = [];
      console.log(`[Backfill] Progress: ${processed + skipped + failed}/${totalFound}`);
    }
  }

  // Process remaining items in last batch
  if (batch.length > 0) {
    const stats = await processBatch(batch, modelInfo);
    processed += stats.processed;
    skipped += stats.skipped;
    failed += stats.failed;
  }

  console.log(
    `[Backfill] Completed: processed=${processed}, skipped=${skipped}, failed=${failed}, total=${totalFound}`
  );

  return {
    totalFound,
    processed,
    skipped,
    failed,
    model: modelInfo.model,
  };
}

/**
 * Process a batch of chunks
 */
async function processBatch(chunks, modelInfo) {
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  const validChunks = [];
  const validTexts = [];

  for (const chunk of chunks) {
    if (!chunk.text || !chunk.text.trim()) {
      skipped++;
      continue;
    }
    validChunks.push(chunk);
    validTexts.push(chunk.text);
  }

  if (validTexts.length === 0) {
    return { processed, skipped, failed };
  }

  try {
    const embeddings = await embeddingService.embedBatch(validTexts, {
      batchSize: validTexts.length,
    });

    const now = new Date();
    const bulkOps = validChunks.map((chunk, i) => ({
      updateOne: {
        filter: { _id: chunk._id },
        update: {
          $set: {
            embedding: embeddings[i],
            embeddingModel: modelInfo.model,
            embeddingVersion: modelInfo.version,
            embeddedAt: now,
          },
        },
      },
    }));

    if (bulkOps.length > 0) {
      await Chunk.bulkWrite(bulkOps);
      processed += bulkOps.length;
    }
  } catch (err) {
    console.error('[Backfill] Batch embedding failed:', err.message);
    failed += validChunks.length;
  }

  return { processed, skipped, failed };
}

/**
 * CLI Runner
 */
async function runCli() {
  const args = process.argv.slice(2);

  let tenantId;
  let batchSize = 32;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant' || args[i] === '--tenantId') {
      tenantId = args[++i];
    } else if (args[i] === '--batch-size' || args[i] === '--batchSize') {
      batchSize = parseInt(args[++i], 10) || 32;
    } else if (args[i] === '--force') {
      force = true;
    }
  }

  try {
    await connectDB();
    await backfillEmbeddings({ tenantId, batchSize, force });
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  backfillEmbeddings,
  isEmbeddingValidAndCurrent,
};

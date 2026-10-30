const mongoose = require('mongoose');
const Chunk = require('../models/Chunk');
const embeddingService = require('./embedding.service');
const { VECTOR_INDEX_NAME } = require('./vectorIndex.service');

/**
 * Perform indexed vector search using MongoDB Atlas $vectorSearch (HNSW / ANN)
 * Enforces strict tenant isolation and embedding model compatibility.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.embeddingModel
 * @param {number[]} params.queryVector
 * @param {number} params.topK
 * @param {number} [params.numCandidates]
 * @param {number} [params.minScore]
 * @returns {Promise<Array<{ chunkId: string, documentId: string, score: number, text: string, metadata: object }>>}
 */
async function retrieveIndexedVectorChunks({
  tenantId,
  embeddingModel,
  queryVector,
  topK,
  numCandidates,
  minScore,
}) {
  const effectiveNumCandidates =
    numCandidates ||
    parseInt(process.env.VECTOR_NUM_CANDIDATES, 10) ||
    Math.max(100, topK * 20);

  const pipeline = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        numCandidates: effectiveNumCandidates,
        limit: topK,
        filter: {
          tenantId: { $eq: tenantId.trim() },
          embeddingModel: { $eq: embeddingModel },
        },
      },
    },
    {
      $project: {
        _id: 1,
        documentId: 1,
        text: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];

  const results = await Chunk.aggregate(pipeline);

  const filtered =
    typeof minScore === 'number'
      ? (results || []).filter((doc) => doc.score >= minScore)
      : results || [];

  return filtered.map((doc) => ({
    chunkId: doc._id,
    documentId: doc.documentId,
    score: typeof doc.score === 'number' ? parseFloat(doc.score.toFixed(4)) : 0,
    text: doc.text,
    metadata: doc.metadata || {},
  }));
}

/**
 * Fallback: In-memory exact k-NN brute-force scan across tenant chunks.
 * Enforces strict tenant isolation and embedding model compatibility.
 * Bounded by maxScanLimit to prevent out-of-memory crashes on large corpuses.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.embeddingModel
 * @param {number[]} params.queryVector
 * @param {number} params.topK
 * @param {number} [params.minScore]
 * @param {number} [params.maxScanLimit=5000]
 * @returns {Promise<Array<{ chunkId: string, documentId: string, score: number, text: string, metadata: object }>>}
 */
async function retrieveExactScanChunks({
  tenantId,
  embeddingModel,
  queryVector,
  topK,
  minScore,
  maxScanLimit = 5000,
}) {
  const query = {
    tenantId: tenantId.trim(),
    embedding: { $exists: true, $ne: null },
  };

  if (embeddingModel) {
    query.embeddingModel = embeddingModel;
  }

  const tenantChunks = await Chunk.find(query)
    .select('_id documentId text metadata embedding')
    .limit(maxScanLimit)
    .lean();

  if (!tenantChunks || tenantChunks.length === 0) {
    return [];
  }

  const scoredChunks = [];

  for (const chunk of tenantChunks) {
    if (!chunk.embedding || chunk.embedding.length !== queryVector.length) {
      continue;
    }

    // Full-precision cosine similarity
    const rawSimilarity = embeddingService.cosineSimilarity(queryVector, chunk.embedding);

    if (typeof minScore === 'number' && rawSimilarity < minScore) {
      continue;
    }

    scoredChunks.push({
      chunkId: chunk._id,
      documentId: chunk.documentId,
      rawScore: rawSimilarity,
      text: chunk.text,
      metadata: chunk.metadata || {},
    });
  }

  // Sort by full-precision score descending
  scoredChunks.sort((a, b) => b.rawScore - a.rawScore);

  return scoredChunks.slice(0, topK).map((item) => ({
    chunkId: item.chunkId,
    documentId: item.documentId,
    score: parseFloat(item.rawScore.toFixed(4)),
    text: item.text,
    metadata: item.metadata,
  }));
}

/**
 * Retrieve top-k semantically relevant chunks for a given query and tenant.
 * Uses indexed MongoDB Atlas $vectorSearch (HNSW) when available.
 * Fallback to exact scan is explicit, observable, and bounded.
 *
 * @param {object} params
 * @param {string} params.tenantId - Tenant identifier (strict isolation)
 * @param {string} params.query - Natural language query
 * @param {number} [params.topK=5] - Maximum number of chunks to return (1 <= topK <= 100)
 * @param {number} [params.minScore] - Optional minimum similarity threshold
 * @param {('auto'|'indexed'|'exact')} [params.mode='auto'] - Search strategy
 * @param {number} [params.numCandidates] - Configurable HNSW candidate count
 * @returns {Promise<Array<{ chunkId: string, documentId: string, score: number, text: string, metadata: object }>>}
 */
async function retrieveSemanticChunks({
  tenantId,
  query,
  topK = 5,
  minScore,
  mode = 'auto',
  numCandidates,
}) {
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new Error('tenantId is required');
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  const parsedTopK = Math.max(1, Math.min(100, parseInt(topK, 10) || 5));
  const modelInfo = embeddingService.getModelInfo();

  // 1. Generate and validate query embedding
  const queryVector = await embeddingService.embedText(query.trim());
  if (!queryVector || queryVector.length === 0) {
    return [];
  }

  // 2. Handle explicit exact mode
  if (mode === 'exact') {
    return retrieveExactScanChunks({
      tenantId,
      embeddingModel: modelInfo.model,
      queryVector,
      topK: parsedTopK,
      minScore,
    });
  }

  // 3. Attempt Atlas Vector Search (Indexed HNSW)
  const isConnected = mongoose.connection && mongoose.connection.readyState === 1;

  if (isConnected || mode === 'indexed') {
    try {
      return await retrieveIndexedVectorChunks({
        tenantId,
        embeddingModel: modelInfo.model,
        queryVector,
        topK: parsedTopK,
        numCandidates,
        minScore,
      });
    } catch (error) {
      if (mode === 'indexed') {
        throw error;
      }

      // Check whether exhaustive fallback is permitted in this environment
      const allowFallback =
        process.env.ALLOW_EXHAUSTIVE_FALLBACK !== 'false' &&
        process.env.NODE_ENV !== 'production';

      if (!allowFallback) {
        console.error(
          `[retrieveSemanticChunks] Atlas $vectorSearch failed (${error.message}). Exhaustive fallback disabled in production.`
        );
        throw new Error(
          `Vector search unavailable: ${error.message}. Exhaustive fallback is disabled.`
        );
      }

      console.warn(
        `[retrieveSemanticChunks] Atlas $vectorSearch unavailable (${error.message}). Falling back to bounded exact scan.`
      );
    }
  }

  // 4. Bounded exact scan fallback
  return retrieveExactScanChunks({
    tenantId,
    embeddingModel: modelInfo.model,
    queryVector,
    topK: parsedTopK,
    minScore,
  });
}

module.exports = {
  retrieveSemanticChunks,
  retrieveIndexedVectorChunks,
  retrieveExactScanChunks,
};

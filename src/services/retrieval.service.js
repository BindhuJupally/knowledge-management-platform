const Chunk = require('../models/Chunk');
const { tokenize } = require('../utils/tokenizer');

/**
 * Standard Okapi BM25 parameters
 */
const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/**
 * Calculate BM25 scores for a tenant's chunks given a query
 * @param {object} params
 * @param {string} params.tenantId - Tenant identifier
 * @param {string} params.query - Query string
 * @param {number} [params.topK=5] - Number of top chunks to return
 * @param {number} [params.k1=1.5] - BM25 k1 parameter
 * @param {number} [params.b=0.75] - BM25 b parameter
 * @returns {Promise<Array<{ chunkId: string, documentId: string, score: number, text: string, metadata: object }>>}
 */
async function retrieveTopChunks({ tenantId, query, topK = 5, k1 = DEFAULT_K1, b = DEFAULT_B }) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  // 1. Tokenize query
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  // 2. Fetch all chunks belonging to this tenant
  const chunks = await Chunk.find({ tenantId }).lean();
  const N = chunks.length;
  if (N === 0) {
    return [];
  }

  // 3. Compute corpus statistics: avgdl and document frequency df for query terms
  let totalLength = 0;
  const chunkLengths = new Map();
  const chunkTermFreqs = new Map(); // chunkId -> Map(term -> count)

  for (const chunk of chunks) {
    const chunkId = chunk._id.toString();
    const tokens = chunk.tokens || [];
    const dl = tokens.length;
    chunkLengths.set(chunkId, dl);
    totalLength += dl;

    const tfMap = new Map();
    for (const token of tokens) {
      tfMap.set(token, (tfMap.get(token) || 0) + 1);
    }
    chunkTermFreqs.set(chunkId, tfMap);
  }

  const avgdl = totalLength / N || 1;

  // Calculate df (document frequency: number of chunks containing query term)
  const df = new Map();
  const uniqueQueryTokens = Array.from(new Set(queryTokens));

  for (const term of uniqueQueryTokens) {
    let count = 0;
    for (const chunk of chunks) {
      const tfMap = chunkTermFreqs.get(chunk._id.toString());
      if (tfMap && tfMap.has(term)) {
        count++;
      }
    }
    df.set(term, count);
  }

  // 4. Calculate BM25 score for each chunk
  const scoredChunks = [];

  for (const chunk of chunks) {
    const chunkId = chunk._id.toString();
    const dl = chunkLengths.get(chunkId) || 0;
    const tfMap = chunkTermFreqs.get(chunkId) || new Map();
    let score = 0;

    for (const term of uniqueQueryTokens) {
      const nTerm = df.get(term) || 0;
      if (nTerm === 0) continue;

      // Robertson-Spärck Jones IDF with smoothing (+ 1 to prevent negative scores)
      const idf = Math.log(1 + (N - nTerm + 0.5) / (nTerm + 0.5));

      const tf = tfMap.get(term) || 0;
      if (tf === 0) continue;

      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (dl / avgdl));
      score += idf * (numerator / denominator);
    }

    if (score > 0) {
      scoredChunks.push({
        chunkId: chunk._id,
        documentId: chunk.documentId,
        score: parseFloat(score.toFixed(4)),
        text: chunk.text,
        metadata: chunk.metadata || {},
      });
    }
  }

  // 5. Sort by score descending and return top-k
  scoredChunks.sort((a, b) => b.score - a.score);

  return scoredChunks.slice(0, topK);
}

module.exports = {
  retrieveTopChunks,
  DEFAULT_K1,
  DEFAULT_B,
};

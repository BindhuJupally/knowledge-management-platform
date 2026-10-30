const retrievalService = require('../services/retrieval.service');
const semanticRetrievalService = require('../services/semanticRetrieval.service');
const embeddingService = require('../services/embedding.service');

/**
 * Handle query retrieval (BM25 lexical)
 * POST /api/query
 */
async function queryChunks(req, res) {
  try {
    const { tenantId, query, topK = 5 } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query string is required' });
    }

    const parsedTopK = parseInt(topK, 10) || 5;

    const results = await retrievalService.retrieveTopChunks({
      tenantId,
      query: query.trim(),
      topK: parsedTopK,
    });

    return res.status(200).json({
      query: query.trim(),
      results,
    });
  } catch (error) {
    console.error('[queryChunks] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * Handle semantic query retrieval (Dense vector similarity)
 * POST /api/query/semantic
 */
async function querySemanticChunks(req, res) {
  try {
    const { tenantId, query, topK, minScore, mode = 'auto' } = req.body;

    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query string is required' });
    }

    let parsedTopK = 5;
    if (topK !== undefined) {
      if (typeof topK !== 'number' && typeof topK !== 'string') {
        return res.status(400).json({ error: 'topK must be an integer between 1 and 100' });
      }
      const num = Number(topK);
      if (!Number.isInteger(num) || num < 1 || num > 100) {
        return res.status(400).json({ error: 'topK must be an integer between 1 and 100' });
      }
      parsedTopK = num;
    }

    let parsedMinScore;
    if (minScore !== undefined) {
      const num = Number(minScore);
      if (typeof minScore === 'boolean' || isNaN(num) || !Number.isFinite(num)) {
        return res.status(400).json({ error: 'minScore must be a valid finite number' });
      }
      parsedMinScore = num;
    }

    const modelInfo = embeddingService.getModelInfo();

    const results = await semanticRetrievalService.retrieveSemanticChunks({
      tenantId: tenantId.trim(),
      query: query.trim(),
      topK: parsedTopK,
      minScore: parsedMinScore,
      mode,
    });

    return res.status(200).json({
      query: query.trim(),
      retrievalMethod: 'semantic',
      embeddingModel: modelInfo.model,
      results,
    });
  } catch (error) {
    console.error('[querySemanticChunks] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

module.exports = {
  queryChunks,
  querySemanticChunks,
};

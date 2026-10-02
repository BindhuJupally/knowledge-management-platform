const { retrieveTopChunks } = require('../services/retrieval.service');

/**
 * Handle query retrieval
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

    const results = await retrieveTopChunks({
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

module.exports = {
  queryChunks,
};

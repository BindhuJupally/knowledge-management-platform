const { validateUrl } = require('../utils/urlValidator');
const websiteService = require('../services/website.service');

/**
 * Ingest a website (single-page or BFS multi-page deep crawl)
 * POST /api/documents/website
 */
async function crawlAndIngestWebsite(req, res) {
  try {
    const { url, tenantId = 'tenant1', deepCrawl = false } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required in request body' });
    }

    // SSRF & protocol validation
    const validation = await validateUrl(url);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Sanitize crawl parameters
    const maxPages = Math.min(Math.max(parseInt(req.body.maxPages, 10) || 10, 1), 50);
    const maxDepth = Math.min(Math.max(parseInt(req.body.maxDepth, 10) || 2, 1), 3);

    const result = await websiteService.ingestWebsite({
      tenantId,
      url: validation.normalizedUrl,
      deepCrawl: Boolean(deepCrawl),
      maxPages,
      maxDepth,
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('[crawlAndIngestWebsite] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to crawl and ingest website',
    });
  }
}

module.exports = {
  crawlAndIngestWebsite,
};

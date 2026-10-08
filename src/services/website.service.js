const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const { createChunks } = require('./chunking.service');
const gridfsService = require('./gridfs.service');
const { tokenize } = require('../utils/tokenizer');

/**
 * Determine the python executable path (prefer project .venv)
 */
function getPythonExecutable() {
  const venvPython = path.resolve(__dirname, '../../.venv/bin/python3');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

/**
 * Run Crawl4AI via Python script
 * @param {object} params
 * @param {string} params.url - URL to crawl
 * @param {boolean} [params.deepCrawl=false] - Whether to BFS deep crawl
 * @param {number} [params.maxPages=10] - Maximum pages for deep crawl
 * @param {number} [params.maxDepth=2] - Maximum depth for deep crawl
 * @returns {Promise<Array<{ url: string, title: string, markdown: string }>>}
 */
async function executeCrawler({ url, deepCrawl = false, maxPages = 10, maxDepth = 2 }) {
  const pythonPath = getPythonExecutable();
  const scriptPath = path.resolve(__dirname, '../scripts/crawler.py');

  const args = [scriptPath, '--url', url];
  if (deepCrawl) {
    args.push('--deep', '--max-pages', String(maxPages), '--max-depth', String(maxDepth));
  }

  return new Promise((resolve, reject) => {
    execFile(
      pythonPath,
      args,
      {
        maxBuffer: 30 * 1024 * 1024, // 30 MB buffer
        timeout: 120000, // 2 minutes timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(`Crawler process failed: ${error.message}${stderr ? ' - ' + stderr : ''}`)
          );
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (!result.success) {
            return reject(new Error(result.error || 'Failed to crawl webpage'));
          }
          resolve(result.pages || []);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse crawler response: ${parseError.message}. Output was: ${stdout.slice(0, 300)}`
            )
          );
        }
      }
    );
  });
}

/**
 * Ingest a single webpage page record into MongoDB GridFS, Document, and Chunks
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.url
 * @param {string} params.title
 * @param {string} params.markdown
 * @param {string} params.crawlSessionId
 * @returns {Promise<{ documentId: string, fileId: string, url: string, title: string, chunksCreated: number }>}
 */
async function ingestSingleWebpage({ tenantId, url, title, markdown, crawlSessionId }) {
  const pageTitle = title || url;
  const markdownBuffer = Buffer.from(markdown, 'utf-8');

  // Sanitize filename for GridFS
  const safeFilename =
    pageTitle
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) + '.md';

  // 1. Store raw Markdown in GridFS for auditability and download
  const fileId = await gridfsService.uploadBufferToGridFS(markdownBuffer, safeFilename, 'text/markdown', {
    tenantId,
    sourceUrl: url,
    crawlSessionId,
  });

  // 2. Persist Document metadata
  const document = await Document.create({
    tenantId,
    filename: pageTitle,
    fileType: 'website',
    sourceUrl: url,
    title: pageTitle,
    crawlSessionId,
    fileId,
    fileSize: markdownBuffer.length,
    mimeType: 'text/markdown',
    status: 'active',
    uploadedAt: new Date(),
  });

  // 3. Chunk the extracted Markdown
  const rawChunks = createChunks(markdown, { chunkSize: 450, overlap: 50 });

  // 4. Tokenize & prepare Chunk records
  const chunkDocs = rawChunks.map((chunk) => {
    const tokens = tokenize(chunk.text);
    return {
      tenantId,
      documentId: document._id,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      tokens,
      tokenCount: tokens.length,
      metadata: {
        source_type: 'website',
        url,
        title: pageTitle,
        crawlSessionId,
        ...chunk.metadata,
      },
    };
  });

  // 5. Bulk insert chunks
  if (chunkDocs.length > 0) {
    await Chunk.insertMany(chunkDocs);
  }

  return {
    documentId: document._id.toString(),
    fileId: document.fileId.toString(),
    url,
    title: pageTitle,
    chunksCreated: chunkDocs.length,
  };
}

/**
 * Ingest website (handles both single page and multi-page deep crawls)
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.url
 * @param {boolean} [params.deepCrawl=false]
 * @param {number} [params.maxPages=10]
 * @param {number} [params.maxDepth=2]
 * @param {Array<object>} [params.preCrawledPages] - Optional for testing/mocking
 * @returns {Promise<object>}
 */
async function ingestWebsite({
  tenantId,
  url,
  deepCrawl = false,
  maxPages = 10,
  maxDepth = 2,
  preCrawledPages = null,
}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  if (!url) {
    throw new Error('url is required');
  }

  // 1. Fetch pages via Crawl4AI (or use preCrawledPages in unit tests)
  const pages =
    preCrawledPages ||
    (await executeCrawler({
      url,
      deepCrawl,
      maxPages,
      maxDepth,
    }));

  if (!pages || pages.length === 0) {
    throw new Error('No content could be extracted from the provided URL');
  }

  const crawlSessionId = `crawl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const ingestedDocuments = [];
  let totalChunksCreated = 0;

  // 2. Ingest each webpage independently
  for (const page of pages) {
    if (!page.markdown || !page.markdown.trim()) {
      continue;
    }

    const docResult = await ingestSingleWebpage({
      tenantId,
      url: page.url || url,
      title: page.title,
      markdown: page.markdown,
      crawlSessionId,
    });

    ingestedDocuments.push(docResult);
    totalChunksCreated += docResult.chunksCreated;
  }

  return {
    message: `Successfully ingested ${ingestedDocuments.length} webpage(s)`,
    crawlSessionId,
    deepCrawl,
    pagesIngested: ingestedDocuments.length,
    documents: ingestedDocuments,
    totalChunksCreated,
  };
}

module.exports = {
  executeCrawler,
  ingestSingleWebpage,
  ingestWebsite,
  getPythonExecutable,
};

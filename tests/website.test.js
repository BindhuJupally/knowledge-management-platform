const dns = require('dns').promises;
const { crawlAndIngestWebsite } = require('../src/controllers/website.controller');
const websiteService = require('../src/services/website.service');
const embeddingService = require('../src/services/embedding.service');
const Document = require('../src/models/Document');
const Chunk = require('../src/models/Chunk');
const gridfsService = require('../src/services/gridfs.service');
const mongoose = require('mongoose');

describe('Website Ingestion Controller and Service', () => {
  describe('Website Controller - Input & SSRF Validation', () => {
    let mockReq;
    let mockRes;

    beforeEach(() => {
      mockReq = {
        body: {},
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
    });

    test('should return 400 if url is missing', async () => {
      mockReq.body = { tenantId: 'tenant1' };

      await crawlAndIngestWebsite(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('url is required') })
      );
    });

    test('should return 400 for localhost or loopback (SSRF defense)', async () => {
      mockReq.body = { url: 'http://localhost:3000/internal-admin' };

      await crawlAndIngestWebsite(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('forbidden') })
      );
    });

    test('should return 400 for private IP range (SSRF defense)', async () => {
      mockReq.body = { url: 'http://192.168.1.1/router' };

      await crawlAndIngestWebsite(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('forbidden') })
      );
    });

    test('should return 400 for cloud metadata endpoint (SSRF defense)', async () => {
      mockReq.body = { url: 'http://169.254.169.254/latest/meta-data/' };

      await crawlAndIngestWebsite(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('forbidden') })
      );
    });

    test('should return 400 for non-http/https protocol', async () => {
      mockReq.body = { url: 'ftp://ftp.example.com/files' };

      await crawlAndIngestWebsite(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Unsupported protocol') })
      );
    });

    test('should invoke service and return 201 for valid public URL', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
      const mockResult = {
        message: 'Successfully ingested 1 webpage(s)',
        crawlSessionId: 'crawl_test_123',
        pagesIngested: 1,
        documents: [{ documentId: 'doc1', chunksCreated: 2 }],
        totalChunksCreated: 2,
      };

      jest.spyOn(websiteService, 'ingestWebsite').mockResolvedValueOnce(mockResult);

      mockReq.body = {
        url: 'https://example.com/docs',
        tenantId: 'tenant1',
        deepCrawl: false,
      };

      await crawlAndIngestWebsite(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);

      dns.lookup.mockRestore();
      websiteService.ingestWebsite.mockRestore();
    });
  });

  describe('Website Service - Ingestion Logic', () => {
    const mockFileId = new mongoose.Types.ObjectId();
    const mockDocId = new mongoose.Types.ObjectId();

    beforeEach(() => {
      jest.spyOn(gridfsService, 'uploadBufferToGridFS').mockResolvedValue(mockFileId);
      jest.spyOn(Document, 'create').mockImplementation(async (data) => ({
        _id: mockDocId,
        ...data,
      }));
      jest.spyOn(Chunk, 'insertMany').mockResolvedValue([]);
      // Mock embedding so tests don't require a live COHERE_API_KEY
      jest.spyOn(embeddingService, 'embedBatch').mockImplementation(async (texts) =>
        texts.map(() => new Array(384).fill(0))
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('ingestSingleWebpage should store markdown in GridFS and create Document and Chunks', async () => {
      const markdownContent =
        '# Introduction\n\nCrawl4AI is an open-source web crawler designed for AI and LLMs.';

      const result = await websiteService.ingestSingleWebpage({
        tenantId: 'tenant1',
        url: 'https://example.com/intro',
        title: 'Introduction to Crawl4AI',
        markdown: markdownContent,
        crawlSessionId: 'crawl_123',
      });

      expect(result.url).toBe('https://example.com/intro');
      expect(result.title).toBe('Introduction to Crawl4AI');
      expect(result.chunksCreated).toBeGreaterThan(0);

      // Verify GridFS upload
      expect(gridfsService.uploadBufferToGridFS).toHaveBeenCalledTimes(1);

      // Verify Document record creation
      expect(Document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant1',
          fileType: 'website',
          sourceUrl: 'https://example.com/intro',
          title: 'Introduction to Crawl4AI',
          crawlSessionId: 'crawl_123',
        })
      );

      // Verify Chunk insertion with metadata and embeddings
      expect(Chunk.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'tenant1',
            embedding: expect.any(Array),
            embeddingModel: expect.any(String),
            metadata: expect.objectContaining({
              source_type: 'website',
              url: 'https://example.com/intro',
              title: 'Introduction to Crawl4AI',
              crawlSessionId: 'crawl_123',
            }),
          }),
        ])
      );
    });

    test('ingestWebsite should handle multi-page crawling by creating 1 Document per page', async () => {
      const mockPages = [
        {
          url: 'https://example.com/page1',
          title: 'Page 1',
          markdown: 'Content for first page with some descriptive text.',
        },
        {
          url: 'https://example.com/page2',
          title: 'Page 2',
          markdown: 'Content for second page detailing the API specifications.',
        },
      ];

      const result = await websiteService.ingestWebsite({
        tenantId: 'tenant1',
        url: 'https://example.com',
        deepCrawl: true,
        preCrawledPages: mockPages,
      });

      expect(result.pagesIngested).toBe(2);
      expect(result.documents.length).toBe(2);
      expect(Document.create).toHaveBeenCalledTimes(2);
      expect(gridfsService.uploadBufferToGridFS).toHaveBeenCalledTimes(2);
      expect(Chunk.insertMany).toHaveBeenCalledTimes(2);
    });

    test('ingestWebsite should throw error if url or tenantId is missing', async () => {
      await expect(
        websiteService.ingestWebsite({ tenantId: '', url: 'https://example.com' })
      ).rejects.toThrow('tenantId is required');

      await expect(
        websiteService.ingestWebsite({ tenantId: 'tenant1', url: '' })
      ).rejects.toThrow('url is required');
    });
  });
});

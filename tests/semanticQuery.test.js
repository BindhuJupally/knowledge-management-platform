const request = require('supertest');
const app = require('../src/app');
const semanticRetrievalService = require('../src/services/semanticRetrieval.service');
const retrievalService = require('../src/services/retrieval.service');

describe('Semantic Query API (POST /api/query/semantic)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns 400 if tenantId is missing', async () => {
    const res = await request(app)
      .post('/api/query/semantic')
      .send({ query: 'What is the leave policy?' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('tenantId is required');
  });

  test('returns 400 if query string is missing or empty', async () => {
    const res = await request(app)
      .post('/api/query/semantic')
      .send({ tenantId: 'tenant1', query: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('query string is required');
  });

  test('returns 400 if topK is invalid (SEM-08)', async () => {
    const resNegative = await request(app).post('/api/query/semantic').send({
      tenantId: 'tenant1',
      query: 'test query',
      topK: -1,
    });
    expect(resNegative.status).toBe(400);
    expect(resNegative.body.error).toContain('topK must be an integer between 1 and 100');

    const resZero = await request(app).post('/api/query/semantic').send({
      tenantId: 'tenant1',
      query: 'test query',
      topK: 0,
    });
    expect(resZero.status).toBe(400);
    expect(resZero.body.error).toContain('topK must be an integer between 1 and 100');

    const resLarge = await request(app).post('/api/query/semantic').send({
      tenantId: 'tenant1',
      query: 'test query',
      topK: 105,
    });
    expect(resLarge.status).toBe(400);
    expect(resLarge.body.error).toContain('topK must be an integer between 1 and 100');

    const resStringJunk = await request(app).post('/api/query/semantic').send({
      tenantId: 'tenant1',
      query: 'test query',
      topK: 'not_a_number',
    });
    expect(resStringJunk.status).toBe(400);
    expect(resStringJunk.body.error).toContain('topK must be an integer between 1 and 100');
  });

  test('returns 400 if minScore is not a valid number', async () => {
    const res = await request(app).post('/api/query/semantic').send({
      tenantId: 'tenant1',
      query: 'test query',
      minScore: 'invalid_score',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('minScore must be a valid finite number');
  });

  test('returns 200 with semantic results and metadata', async () => {
    const mockResults = [
      {
        chunkId: 'chunk_123',
        documentId: 'doc_123',
        score: 0.88,
        text: 'Interns are entitled to 12 days annual vacation leave policy',
        metadata: { page: 1 },
      },
    ];

    jest.spyOn(semanticRetrievalService, 'retrieveSemanticChunks').mockResolvedValue(mockResults);

    const res = await request(app).post('/api/query/semantic').send({
      tenantId: 'tenant1',
      query: 'What vacation benefits do trainees receive?',
      topK: 3,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      query: 'What vacation benefits do trainees receive?',
      retrievalMethod: 'semantic',
      embeddingModel: expect.any(String),
      results: mockResults,
    });
  });

  test('ensures existing POST /api/query (BM25) remains intact and unchanged', async () => {
    const mockBm25Results = [
      {
        chunkId: 'chunk_bm25_1',
        documentId: 'doc_bm25_1',
        score: 4.52,
        text: 'Course syllabus credits and grading',
        metadata: {},
      },
    ];

    jest.spyOn(retrievalService, 'retrieveTopChunks').mockResolvedValue(mockBm25Results);

    const res = await request(app).post('/api/query').send({
      tenantId: 'tenant1',
      query: 'Course syllabus',
      topK: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      query: 'Course syllabus',
      results: mockBm25Results,
    });
    // Does not have semantic fields
    expect(res.body.retrievalMethod).toBeUndefined();
  });
});

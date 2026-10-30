const mongoose = require('mongoose');
const {
  retrieveSemanticChunks,
  retrieveIndexedVectorChunks,
  retrieveExactScanChunks,
} = require('../src/services/semanticRetrieval.service');
const embeddingService = require('../src/services/embedding.service');
const Chunk = require('../src/models/Chunk');

describe('Semantic Retrieval Service', () => {
  const docId1 = new mongoose.Types.ObjectId();
  const docId2 = new mongoose.Types.ObjectId();

  function mockFindWithChunks(chunks) {
    return jest.spyOn(Chunk, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(chunks),
        }),
        lean: jest.fn().mockResolvedValue(chunks),
      }),
    });
  }

  beforeEach(() => {
    embeddingService.setConfig({
      provider: 'local',
      model: 'local-dense-384',
      dimension: 384,
      version: '1.0',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('throws error if tenantId is missing or empty', async () => {
    await expect(retrieveSemanticChunks({ tenantId: '', query: 'test' })).rejects.toThrow(
      'tenantId is required'
    );
    await expect(retrieveSemanticChunks({ tenantId: null, query: 'test' })).rejects.toThrow(
      'tenantId is required'
    );
  });

  test('returns empty array if query is empty or whitespace', async () => {
    const results = await retrieveSemanticChunks({ tenantId: 'tenant1', query: '   ' });
    expect(results).toEqual([]);
  });

  test('enforces strict tenant isolation and filters by tenantId', async () => {
    const mockFind = mockFindWithChunks([]);

    await retrieveSemanticChunks({
      tenantId: 'tenantA',
      query: 'vacation policy',
      mode: 'exact',
    });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenantA',
      })
    );
  });

  test('enforces embedding model compatibility — SEM-01', async () => {
    const mockFind = mockFindWithChunks([]);

    await retrieveSemanticChunks({
      tenantId: 'tenantA',
      query: 'vacation policy',
      mode: 'exact',
    });

    // Must query with current embeddingModel to prevent cross-model vector collisions
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingModel: 'local-dense-384',
      })
    );
  });

  test('orders chunks by cosine similarity descending and respects topK', async () => {
    const textRelevant = 'Interns are entitled to 12 days annual vacation leave policy';
    const textPartial = 'General leave and working hours regulations';
    const textIrrelevant = 'Quantum electrodynamics physics laboratory';

    const [vecRel, vecPart, vecIrrel] = await Promise.all([
      embeddingService.embedText(textRelevant),
      embeddingService.embedText(textPartial),
      embeddingService.embedText(textIrrelevant),
    ]);

    const mockChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: textIrrelevant,
        embedding: vecIrrel,
        embeddingModel: 'local-dense-384',
        metadata: { page: 3 },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: textRelevant,
        embedding: vecRel,
        embeddingModel: 'local-dense-384',
        metadata: { page: 1 },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId2,
        text: textPartial,
        embedding: vecPart,
        embeddingModel: 'local-dense-384',
        metadata: { page: 2 },
      },
    ];

    mockFindWithChunks(mockChunks);

    const results = await retrieveSemanticChunks({
      tenantId: 'tenant1',
      query: 'What vacation benefits do trainees receive?',
      topK: 2,
      mode: 'exact',
    });

    expect(results.length).toBe(2);
    // Highest similarity should be first
    expect(results[0].text).toBe(textRelevant);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0]).toHaveProperty('chunkId');
    expect(results[0]).toHaveProperty('documentId');
    expect(results[0]).toHaveProperty('score');
  });

  test('skips chunks with missing or mismatched embeddings safely', async () => {
    const mockChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: 'Chunk without vector',
        embedding: null,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: 'Chunk with wrong dimension vector',
        embedding: [0.1, 0.2], // wrong dimension
      },
    ];

    mockFindWithChunks(mockChunks);

    const results = await retrieveSemanticChunks({
      tenantId: 'tenant1',
      query: 'test query',
      mode: 'exact',
    });

    expect(results).toEqual([]);
  });

  test('preserves low-scoring results when minScore is not specified (SEM-07)', async () => {
    const dummyVec = new Array(384).fill(0.05);
    const mockChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: 'Low score chunk',
        embedding: dummyVec,
      },
    ];

    mockFindWithChunks(mockChunks);

    // Call without minScore: should return the chunk regardless of low score
    const results = await retrieveSemanticChunks({
      tenantId: 'tenant1',
      query: 'quantum mechanics',
      mode: 'exact',
    });

    expect(results.length).toBe(1);
    expect(results[0].text).toBe('Low score chunk');
  });

  test('filters results when minScore threshold is explicitly configured', async () => {
    const dummyVec = new Array(384).fill(0.05);
    const mockChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: 'Chunk below threshold',
        embedding: dummyVec,
      },
    ];

    mockFindWithChunks(mockChunks);

    // Call with impossible threshold: should filter it out
    const results = await retrieveSemanticChunks({
      tenantId: 'tenant1',
      query: 'different domain query',
      minScore: 0.9999,
      mode: 'exact',
    });

    expect(results.length).toBe(0);
  });

  test('executes Atlas $vectorSearch pipeline correctly in indexed mode with model filter', async () => {
    const mockAggregate = jest.spyOn(Chunk, 'aggregate').mockResolvedValue([
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: docId1,
        text: 'Indexed HNSW search result chunk',
        metadata: { page: 1 },
        score: 0.9234,
      },
    ]);

    const dummyQueryVector = new Array(384).fill(0.1);
    const results = await retrieveIndexedVectorChunks({
      tenantId: 'tenant1',
      embeddingModel: 'embed-english-light-v3.0',
      queryVector: dummyQueryVector,
      topK: 3,
      numCandidates: 100,
    });

    expect(mockAggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $vectorSearch: expect.objectContaining({
            index: expect.any(String),
            path: 'embedding',
            queryVector: dummyQueryVector,
            numCandidates: 100,
            limit: 3,
            filter: {
              tenantId: { $eq: 'tenant1' },
              embeddingModel: { $eq: 'embed-english-light-v3.0' },
            },
          }),
        }),
      ])
    );

    expect(results.length).toBe(1);
    expect(results[0].score).toBe(0.9234);
    expect(results[0].text).toBe('Indexed HNSW search result chunk');
  });
});

const {
  embedText,
  embedBatch,
  getEmbeddingDimension,
  getModelInfo,
  setConfig,
  cosineSimilarity,
  normalizeVector,
  validateEmbeddingVector,
  validateEmbeddingBatch,
  fetchWithRetry,
} = require('../src/services/embedding.service');

describe('Embedding Service', () => {
  beforeEach(() => {
    setConfig({
      provider: 'local',
      model: 'local-dense-384',
      dimension: 384,
      version: '1.0',
    });
  });

  describe('Configuration & Dimension Metadata', () => {
    test('returns correct embedding dimension', () => {
      expect(getEmbeddingDimension()).toBe(384);
    });

    test('returns configured model metadata', () => {
      const info = getModelInfo();
      expect(info.provider).toBe('local');
      expect(info.model).toBe('local-dense-384');
      expect(info.dimension).toBe(384);
      expect(info.version).toBe('1.0');
    });

    test('rejects unsupported provider without falling back silently', async () => {
      setConfig({ provider: 'unsupported_provider_xyz' });
      await expect(embedText('sample text')).rejects.toThrow('Unsupported embedding provider');
      await expect(embedBatch(['sample text'])).rejects.toThrow('Unsupported embedding provider');
    });
  });

  describe('Vector Validation (SEM-03)', () => {
    test('passes for valid finite non-zero vectors of correct dimension', () => {
      const validVec = new Array(384).fill(0.05);
      expect(validateEmbeddingVector(validVec, 384)).toBe(true);
    });

    test('rejects non-array vector', () => {
      expect(() => validateEmbeddingVector('invalid', 384)).toThrow('expected array');
    });

    test('rejects vector with dimension mismatch', () => {
      const wrongDim = new Array(128).fill(0.1);
      expect(() => validateEmbeddingVector(wrongDim, 384)).toThrow('dimension mismatch');
    });

    test('rejects vector containing NaN', () => {
      const nanVec = new Array(384).fill(0.1);
      nanVec[10] = NaN;
      expect(() => validateEmbeddingVector(nanVec, 384)).toThrow('non-finite or invalid');
    });

    test('rejects vector containing Infinity or -Infinity', () => {
      const infVec = new Array(384).fill(0.1);
      infVec[5] = Infinity;
      expect(() => validateEmbeddingVector(infVec, 384)).toThrow('non-finite or invalid');

      const negInfVec = new Array(384).fill(0.1);
      negInfVec[5] = -Infinity;
      expect(() => validateEmbeddingVector(negInfVec, 384)).toThrow('non-finite or invalid');
    });

    test('rejects all-zero vector', () => {
      const zeroVec = new Array(384).fill(0);
      expect(() => validateEmbeddingVector(zeroVec, 384)).toThrow('all dimensions are zero');
    });

    test('validateEmbeddingBatch rejects batch count mismatch', () => {
      const vec = new Array(384).fill(0.1);
      expect(() => validateEmbeddingBatch([vec], 2, 384)).toThrow('batch count mismatch');
    });

    test('validateEmbeddingBatch rejects if any vector is malformed', () => {
      const validVec = new Array(384).fill(0.1);
      const invalidVec = new Array(384).fill(0);
      expect(() => validateEmbeddingBatch([validVec, invalidVec], 2, 384)).toThrow(
        'all dimensions are zero'
      );
    });
  });

  describe('API Retry & Timeout (SEM-10, SEM-11)', () => {
    test('retries on HTTP 429 and succeeds on subsequent attempt', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            status: 429,
            headers: new Map([['retry-after', '0']]),
            text: async () => 'Rate limit exceeded',
          });
        }
        return Promise.resolve({
          status: 200,
          headers: new Map(),
          json: async () => ({ success: true }),
        });
      });

      global.fetch = mockFetch;

      const res = await fetchWithRetry('https://api.example.com', {}, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      });

      expect(callCount).toBe(2);
      expect(res.status).toBe(200);
    });

    test('aborts when timeout is exceeded', async () => {
      global.fetch = jest.fn().mockImplementation((url, opts) => {
        return new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      await expect(
        fetchWithRetry('https://api.example.com', {}, {
          timeoutMs: 50,
          maxRetries: 0,
        })
      ).rejects.toThrow();
    });
  });

  describe('embedText', () => {
    test('generates normalized vector with expected dimension', async () => {
      const vector = await embedText('Academic regulations and course syllabus');
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBe(384);

      // Verify L2 norm is ~1
      const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1, 4);
    });

    test('is deterministic for identical input text', async () => {
      const text = 'Computer Science curriculum requirements';
      const vector1 = await embedText(text);
      const vector2 = await embedText(text);
      expect(vector1).toEqual(vector2);
    });

    test('rejects empty or whitespace-only text with descriptive error', async () => {
      await expect(embedText('')).rejects.toThrow('text cannot be empty');
      await expect(embedText('   ')).rejects.toThrow('text cannot be empty');
      await expect(embedText(null)).rejects.toThrow('text must be a non-empty string');
      await expect(embedText(undefined)).rejects.toThrow('text must be a non-empty string');
    });

    test('produces higher similarity for related texts than unrelated texts', async () => {
      const vecBase = await embedText('Interns receive 12 days annual vacation leave policy');
      const vecRelated = await embedText('Trainees get vacation leave benefits and holiday days');
      const vecUnrelated = await embedText('Quantum physics wave particle duality mechanics');

      const simRelated = cosineSimilarity(vecBase, vecRelated);
      const simUnrelated = cosineSimilarity(vecBase, vecUnrelated);

      expect(simRelated).toBeGreaterThan(simUnrelated);
    });
  });

  describe('embedBatch', () => {
    test('returns empty array for empty inputs', async () => {
      const results = await embedBatch([]);
      expect(results).toEqual([]);
    });

    test('generates batch of embeddings preserving order and dimensions', async () => {
      const texts = [
        'First document chunk about admissions',
        'Second document chunk about grading policy',
        'Third document chunk about examination schedule',
      ];

      const vectors = await embedBatch(texts, { batchSize: 2 });
      expect(vectors.length).toBe(3);
      expect(vectors[0].length).toBe(384);
      expect(vectors[1].length).toBe(384);
      expect(vectors[2].length).toBe(384);

      const individual0 = await embedText(texts[0]);
      expect(vectors[0]).toEqual(individual0);
    });

    test('throws if input is not an array', async () => {
      await expect(embedBatch('not an array')).rejects.toThrow('texts must be an array');
    });
  });

  describe('cosineSimilarity', () => {
    test('returns 1 for identical unit vectors', () => {
      const v = normalizeVector([1, 2, 3, 4]);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    test('returns 0 for orthogonal vectors', () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
    });

    test('throws if vector dimensions mismatch', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('identical dimension');
    });
  });
});

const crypto = require('crypto');

/**
 * Default configuration values for embeddings
 *
 * Supported providers:
 *  - 'cohere'  : Cohere Embed API — FREE tier (1000 calls/month, no credit card needed)
 *                Model: embed-english-light-v3.0  (384-dim)
 *  - 'openai'  : OpenAI or any OpenAI-compatible API
 *  - 'local'   : Deterministic hash-projection (dev/unit-test only – NOT semantic)
 */
const CONFIG = {
  provider: process.env.EMBEDDING_PROVIDER || 'cohere',
  model: process.env.EMBEDDING_MODEL || 'embed-english-light-v3.0',
  dimension: parseInt(process.env.EMBEDDING_DIMENSION, 10) || 384,
  version: process.env.EMBEDDING_VERSION || '1.0',
  apiBaseUrl: process.env.EMBEDDING_API_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY || '',
  cohereApiKey: process.env.COHERE_API_KEY || '',
  queryTimeoutMs: parseInt(process.env.EMBEDDING_QUERY_TIMEOUT_MS, 10) || 8000,
  batchTimeoutMs: parseInt(process.env.EMBEDDING_BATCH_TIMEOUT_MS, 10) || 30000,
  maxRetries: parseInt(process.env.EMBEDDING_MAX_RETRIES, 10) || 3,
};

/**
 * Get current configured model metadata
 */
function getModelInfo() {
  return {
    provider: CONFIG.provider,
    model: CONFIG.model,
    dimension: CONFIG.dimension,
    version: CONFIG.version,
  };
}

/**
 * Get embedding vector dimension
 */
function getEmbeddingDimension() {
  return CONFIG.dimension;
}

/**
 * Set runtime configuration (useful for testing and dynamic provider switching)
 */
function setConfig(newConfig = {}) {
  Object.assign(CONFIG, newConfig);
}

/**
 * Normalize a vector to unit length (L2 norm)
 * @param {number[]} vector
 * @returns {number[]}
 */
function normalizeVector(vector) {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/**
 * Validate that an embedding vector is valid and compatible
 * - Must be an Array of numbers
 * - Length must match expectedDimension
 * - Every value must be a finite number (no NaN, Infinity, -Infinity)
 * - Must not be an all-zero vector
 *
 * @param {any} vector
 * @param {number} [expectedDimension]
 * @returns {boolean}
 */
function validateEmbeddingVector(vector, expectedDimension = CONFIG.dimension) {
  if (!Array.isArray(vector)) {
    throw new Error('Invalid embedding vector: expected array of numbers');
  }

  if (vector.length !== expectedDimension) {
    throw new Error(
      `Embedding vector dimension mismatch: expected ${expectedDimension}, got ${vector.length}`
    );
  }

  let hasNonZero = false;
  for (let i = 0; i < vector.length; i++) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(
        `Embedding vector contains non-finite or invalid numeric value at index ${i}: ${val}`
      );
    }
    if (val !== 0) {
      hasNonZero = true;
    }
  }

  if (!hasNonZero) {
    throw new Error('Embedding vector is invalid: all dimensions are zero');
  }

  return true;
}

/**
 * Validate a batch of embedding vectors
 * - Output count must exactly equal input text count
 * - Each vector must satisfy validateEmbeddingVector
 *
 * @param {any[]} vectors
 * @param {number} expectedCount
 * @param {number} [expectedDimension]
 * @returns {boolean}
 */
function validateEmbeddingBatch(vectors, expectedCount, expectedDimension = CONFIG.dimension) {
  if (!Array.isArray(vectors)) {
    throw new Error('Invalid embedding batch response: expected array of vectors');
  }

  if (vectors.length !== expectedCount) {
    throw new Error(
      `Embedding batch count mismatch: expected ${expectedCount} vectors for ${expectedCount} inputs, received ${vectors.length}`
    );
  }

  for (let i = 0; i < vectors.length; i++) {
    try {
      validateEmbeddingVector(vectors[i], expectedDimension);
    } catch (err) {
      throw new Error(`Embedding batch validation failed at index ${i}: ${err.message}`);
    }
  }

  return true;
}

/**
 * Perform HTTP fetch with explicit timeout, exponential backoff with full jitter, and Retry-After support.
 * Retries on transient errors (429, 502, 503, 504, network timeouts).
 *
 * @param {string} url
 * @param {object} fetchOptions
 * @param {object} [retryOptions]
 * @param {number} [retryOptions.maxRetries]
 * @param {number} [retryOptions.timeoutMs]
 * @param {number} [retryOptions.initialDelayMs=300]
 * @param {number} [retryOptions.maxDelayMs=3000]
 * @param {number} [retryOptions.totalTimeoutMs=25000]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, fetchOptions = {}, retryOptions = {}) {
  const maxRetries =
    retryOptions.maxRetries !== undefined ? retryOptions.maxRetries : CONFIG.maxRetries;
  const timeoutMs = retryOptions.timeoutMs || CONFIG.queryTimeoutMs;
  const initialDelayMs = retryOptions.initialDelayMs || 300;
  const maxDelayMs = retryOptions.maxDelayMs || 3000;
  const totalTimeoutMs = retryOptions.totalTimeoutMs || 30000;

  const startTime = Date.now();
  let attempt = 0;

  while (attempt <= maxRetries) {
    const elapsed = Date.now() - startTime;
    const remainingTime = totalTimeoutMs - elapsed;
    if (remainingTime <= 0) {
      throw new Error(
        `Embedding API request exceeded total budget of ${totalTimeoutMs}ms after ${attempt} attempt(s)`
      );
    }

    const currentTimeoutMs = Math.min(timeoutMs, remainingTime);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), currentTimeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Check for transient rate limit or server error statuses
      const isTransient = [429, 502, 503, 504].includes(response.status);
      if (isTransient && attempt < maxRetries) {
        attempt++;
        let delayMs = initialDelayMs * Math.pow(2, attempt - 1);
        // Add full jitter: random value between 0 and delayMs
        delayMs = Math.floor(Math.random() * delayMs);

        // Check for Retry-After header
        const retryAfterHeader = response.headers.get('retry-after');
        if (retryAfterHeader) {
          const parsedSec = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSec) && parsedSec > 0) {
            delayMs = Math.min(parsedSec * 1000, maxDelayMs);
          }
        }
        delayMs = Math.min(delayMs, maxDelayMs);

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbortOrNetwork =
        err.name === 'AbortError' ||
        err.code === 'ECONNRESET' ||
        (err.message && err.message.toLowerCase().includes('timeout'));

      if (isAbortOrNetwork && attempt < maxRetries) {
        attempt++;
        let delayMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        delayMs = Math.floor(Math.random() * delayMs);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Generate a deterministic, pseudo-semantic dense vector for local development and testing.
 * Uses hashed n-grams and character shingles to produce a normalized unit vector.
 * NOTE: This is NOT genuinely semantic — for dev/unit-tests only.
 * @param {string} text
 * @param {number} dimension
 * @returns {number[]}
 */
function generateLocalEmbedding(text, dimension = 384) {
  const vector = new Array(dimension).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    // Return unit vector along dimension 0 for deterministic non-zero test vectors
    vector[0] = 1.0;
    return vector;
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hash = crypto.createHash('sha256').update(word).digest();

    for (let j = 0; j < 8; j++) {
      const idx = hash.readUInt16LE(j * 2) % dimension;
      const sign = hash[j + 16] % 2 === 0 ? 1 : -1;
      const weight = 1.0 + (hash[j] % 50) / 100;
      vector[idx] += sign * weight;
    }

    if (i < words.length - 1) {
      const bigram = `${word}_${words[i + 1]}`;
      const biHash = crypto.createHash('md5').update(bigram).digest();
      const biIdx = biHash.readUInt16LE(0) % dimension;
      vector[biIdx] += 1.5;
    }
  }

  return normalizeVector(vector);
}

/**
 * Call Cohere Embed API to generate real semantic embeddings.
 * Free tier: 1000 API calls/month — no credit card required.
 * Docs: https://docs.cohere.com/reference/embed
 *
 * @param {string[]} texts - Array of input strings (max 96 per call)
 * @param {string} inputType - 'search_document' for indexing, 'search_query' for queries
 * @param {object} [options]
 * @returns {Promise<number[][]>} - Array of normalized embedding vectors
 */
async function callCohereEmbeddingApi(texts, inputType = 'search_document', options = {}) {
  if (!CONFIG.cohereApiKey) {
    throw new Error(
      'COHERE_API_KEY is required for the cohere embedding provider. ' +
        'Get a free key (no credit card) at https://dashboard.cohere.com/api-keys'
    );
  }

  const timeoutMs = options.timeoutMs || (inputType === 'search_query' ? CONFIG.queryTimeoutMs : CONFIG.batchTimeoutMs);

  const response = await fetchWithRetry(
    'https://api.cohere.com/v2/embed',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.cohereApiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model,
        texts,
        input_type: inputType,
        embedding_types: ['float'],
      }),
    },
    {
      timeoutMs,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : CONFIG.maxRetries,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cohere API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.embeddings || !data.embeddings.float || !Array.isArray(data.embeddings.float)) {
    throw new Error('Unexpected response format from Cohere API: missing float embeddings array');
  }

  const vectors = data.embeddings.float.map((vec) => normalizeVector(vec));
  validateEmbeddingBatch(vectors, texts.length, CONFIG.dimension);
  return vectors;
}

/**
 * Generate embeddings using OpenAI or OpenAI-compatible API
 * @param {string[]} texts
 * @param {object} [options]
 * @returns {Promise<number[][]>}
 */
async function callOpenAIEmbeddingApi(texts, options = {}) {
  if (!CONFIG.apiKey) {
    throw new Error('OPENAI_API_KEY is required when using openai embedding provider');
  }

  const timeoutMs = options.timeoutMs || CONFIG.batchTimeoutMs;
  const endpoint = `${CONFIG.apiBaseUrl.replace(/\/+$/, '')}/embeddings`;

  const response = await fetchWithRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model,
        input: texts,
        dimensions: CONFIG.dimension,
      }),
    },
    {
      timeoutMs,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : CONFIG.maxRetries,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Unexpected response format from embedding API: missing data array');
  }

  // Ensure ordering matches input order using the index property
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((item) => normalizeVector(item.embedding));
  validateEmbeddingBatch(vectors, texts.length, CONFIG.dimension);
  return vectors;
}

/**
 * Generate embedding for a single text input (typically a query).
 * Uses 'search_query' input_type for Cohere (optimized for queries).
 * Validates vector before returning.
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<number[]>}
 */
async function embedText(text, options = {}) {
  if (text === null || text === undefined || typeof text !== 'string') {
    throw new Error('Invalid input: text must be a non-empty string');
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid input: text cannot be empty or whitespace only');
  }

  let vector;

  if (CONFIG.provider === 'openai') {
    const [result] = await callOpenAIEmbeddingApi([trimmed], options);
    vector = result;
  } else if (CONFIG.provider === 'cohere') {
    const [result] = await callCohereEmbeddingApi([trimmed], 'search_query', options);
    vector = result;
  } else if (CONFIG.provider === 'local') {
    vector = generateLocalEmbedding(trimmed, CONFIG.dimension);
  } else {
    throw new Error(`Unsupported embedding provider: '${CONFIG.provider}'`);
  }

  validateEmbeddingVector(vector, CONFIG.dimension);
  return vector;
}

/**
 * Generate embeddings for multiple text strings in batches.
 * Uses 'search_document' input_type for Cohere (optimized for indexing).
 * Cohere max batch size is 96 texts per call.
 * Validates batch before returning.
 *
 * @param {string[]} texts
 * @param {object} [options]
 * @param {number} [options.batchSize=32]
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts, options = {}) {
  if (!Array.isArray(texts)) {
    throw new Error('Invalid input: texts must be an array of strings');
  }

  if (texts.length === 0) {
    return [];
  }

  const batchSize = Math.min(options.batchSize || 32, 96);
  const results = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    if (CONFIG.provider === 'openai') {
      const sanitizedBatch = batch.map((t) => (t && typeof t === 'string' ? t.trim() : ' '));
      const batchVectors = await callOpenAIEmbeddingApi(sanitizedBatch, options);
      results.push(...batchVectors);
    } else if (CONFIG.provider === 'cohere') {
      const sanitizedBatch = batch.map((t) =>
        t && typeof t === 'string' && t.trim() ? t.trim() : ' '
      );
      const batchVectors = await callCohereEmbeddingApi(sanitizedBatch, 'search_document', options);
      results.push(...batchVectors);
    } else if (CONFIG.provider === 'local') {
      for (const t of batch) {
        if (!t || typeof t !== 'string' || !t.trim()) {
          const fallbackVec = new Array(CONFIG.dimension).fill(0);
          fallbackVec[0] = 1.0;
          results.push(fallbackVec);
        } else {
          results.push(generateLocalEmbedding(t.trim(), CONFIG.dimension));
        }
      }
    } else {
      throw new Error(`Unsupported embedding provider: '${CONFIG.provider}'`);
    }
  }

  validateEmbeddingBatch(results, texts.length, CONFIG.dimension);
  return results;
}

/**
 * Compute cosine similarity between two normalized vectors.
 * For normalized vectors: cosine similarity = dot product.
 * Full-precision calculation without premature rounding.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    throw new Error('Vectors must be non-empty and of identical dimension');
  }

  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }

  // Clamp within [-1, 1] to prevent floating point inaccuracies
  return Math.max(-1, Math.min(1, dotProduct));
}

module.exports = {
  embedText,
  embedBatch,
  getEmbeddingDimension,
  getModelInfo,
  setConfig,
  normalizeVector,
  validateEmbeddingVector,
  validateEmbeddingBatch,
  cosineSimilarity,
  generateLocalEmbedding,
  fetchWithRetry,
};

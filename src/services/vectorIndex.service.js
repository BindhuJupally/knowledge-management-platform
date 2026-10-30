const mongoose = require('mongoose');
const embeddingService = require('./embedding.service');

const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME || 'vector_index';

/**
 * Check if the Atlas Vector Search index exists and is ready
 * @param {string} [indexName]
 * @returns {Promise<object|null>}
 */
async function getVectorSearchIndex(indexName = VECTOR_INDEX_NAME) {
  try {
    const collection = mongoose.connection.collection('chunks');
    if (!collection || typeof collection.listSearchIndexes !== 'function') {
      return null;
    }

    const cursor = collection.listSearchIndexes();
    const indexes = await cursor.toArray();
    return indexes.find((idx) => idx.name === indexName) || null;
  } catch (error) {
    // If not running on Atlas or command unsupported
    return null;
  }
}

/**
 * Ensure Atlas Vector Search index exists; create it if missing
 * @param {object} [options]
 * @param {string} [options.indexName]
 * @param {number} [options.dimension]
 * @param {string} [options.similarity]
 * @returns {Promise<{ created: boolean, name: string, status: string }>}
 */
async function ensureVectorIndex({
  indexName = VECTOR_INDEX_NAME,
  dimension = embeddingService.getEmbeddingDimension(),
  similarity = 'cosine',
} = {}) {
  const collection = mongoose.connection.collection('chunks');
  if (!collection || typeof collection.createSearchIndex !== 'function') {
    return { created: false, name: indexName, status: 'unsupported' };
  }

  try {
    const existing = await getVectorSearchIndex(indexName);
    if (existing) {
      return {
        created: false,
        name: indexName,
        status: existing.status || 'READY',
      };
    }

    const indexDefinition = {
      name: indexName,
      type: 'vectorSearch',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: dimension,
            similarity,
          },
          {
            type: 'filter',
            path: 'tenantId',
          },
          {
            type: 'filter',
            path: 'embeddingModel',
          },
        ],
      },
    };

    await collection.createSearchIndex(indexDefinition);

    return {
      created: true,
      name: indexName,
      status: 'BUILDING',
    };
  } catch (error) {
    // Search index might already exist or be unsupported
    if (error.codeName === 'IndexAlreadyExists' || error.message.includes('already exists')) {
      return { created: false, name: indexName, status: 'READY' };
    }
    throw error;
  }
}

module.exports = {
  VECTOR_INDEX_NAME,
  getVectorSearchIndex,
  ensureVectorIndex,
};

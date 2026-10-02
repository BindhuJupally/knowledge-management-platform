/**
 * Fixed-size word-based chunking with overlap
 */

/**
 * Split text into chunks based on word count with overlap
 * @param {string} text - Raw extracted text
 * @param {object} options
 * @param {number} [options.chunkSize=450] - Number of words per chunk (400-500 words)
 * @param {number} [options.overlap=50] - Number of overlapping words between consecutive chunks
 * @returns {Array<{ chunkIndex: number, text: string, metadata: object }>}
 */
function createChunks(text, options = {}) {
  const chunkSize = options.chunkSize || 450;
  const overlap = options.overlap || 50;

  if (!text || typeof text !== 'string') {
    return [];
  }

  // Split on whitespace to get word tokens
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const chunks = [];
  let chunkIndex = 0;
  let startIndex = 0;
  const step = Math.max(1, chunkSize - overlap);

  while (startIndex < words.length) {
    const chunkWords = words.slice(startIndex, startIndex + chunkSize);
    const chunkText = chunkWords.join(' ');

    chunks.push({
      chunkIndex,
      text: chunkText,
      metadata: {
        startWordIndex: startIndex,
        endWordIndex: startIndex + chunkWords.length,
      },
    });

    chunkIndex++;
    startIndex += step;

    // If remaining words are less than overlap and we've already chunked, we can break
    if (startIndex >= words.length) {
      break;
    }
  }

  return chunks;
}

module.exports = {
  createChunks,
};

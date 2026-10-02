const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extract plain text from supported document formats (PDF, DOCX, TXT, MD) using in-memory buffer
 * @param {Buffer} buffer - In-memory file buffer from Multer
 * @param {string} fileType - One of 'pdf', 'docx', 'txt', 'md'
 * @returns {Promise<{ text: string, metadata: object }>}
 */
async function extractText(buffer, fileType) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Expected buffer for text extraction');
  }

  const normalizedType = fileType.toLowerCase().replace(/^\./, '');

  switch (normalizedType) {
    case 'pdf': {
      const pdfData = await pdfParse(buffer);
      return {
        text: pdfData.text || '',
        metadata: {
          numpages: pdfData.numpages,
          info: pdfData.info,
        },
      };
    }

    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value || '',
        metadata: {},
      };
    }

    case 'txt':
    case 'md': {
      const text = buffer.toString('utf-8');
      return {
        text,
        metadata: {},
      };
    }

    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

module.exports = {
  extractText,
};

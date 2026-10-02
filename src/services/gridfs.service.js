const mongoose = require('mongoose');
const { Readable } = require('stream');

let bucket;

/**
 * Get or initialize GridFS bucket instance
 */
function getBucket() {
  if (!bucket) {
    if (!mongoose.connection.db) {
      throw new Error('Database connection is not ready');
    }
    bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads',
    });
  }
  return bucket;
}

/**
 * Upload a memory buffer directly into MongoDB GridFS
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} contentType - File MIME type
 * @param {object} metadata - Custom metadata (e.g. tenantId)
 * @returns {Promise<mongoose.Types.ObjectId>}
 */
function uploadBufferToGridFS(buffer, filename, contentType, metadata = {}) {
  return new Promise((resolve, reject) => {
    const gridFSBucket = getBucket();
    const uploadStream = gridFSBucket.openUploadStream(filename, {
      contentType,
      metadata,
    });

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null); // End of stream

    readable
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => {
        resolve(uploadStream.id);
      });
  });
}

/**
 * Get download stream for a file stored in GridFS
 * @param {string|mongoose.Types.ObjectId} fileId
 * @returns {NodeJS.ReadableStream}
 */
function getDownloadStream(fileId) {
  const gridFSBucket = getBucket();
  const objectId = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
  return gridFSBucket.openDownloadStream(objectId);
}

/**
 * Delete a file from GridFS
 * @param {string|mongoose.Types.ObjectId} fileId
 * @returns {Promise<void>}
 */
async function deleteFromGridFS(fileId) {
  const gridFSBucket = getBucket();
  const objectId = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
  try {
    await gridFSBucket.delete(objectId);
  } catch (err) {
    // If already deleted or not found, don't crash
    console.warn(`[GridFS] Warning deleting file ${fileId}: ${err.message}`);
  }
}

module.exports = {
  getBucket,
  uploadBufferToGridFS,
  getDownloadStream,
  deleteFromGridFS,
};

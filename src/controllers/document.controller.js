const path = require('path');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const { extractText } = require('../services/extraction.service');
const { createChunks } = require('../services/chunking.service');
const {
  uploadBufferToGridFS,
  getDownloadStream,
  deleteFromGridFS,
} = require('../services/gridfs.service');
const { tokenize } = require('../utils/tokenizer');

/**
 * Upload, ingest, and store a document in MongoDB GridFS + chunks
 * POST /api/documents
 */
async function uploadDocument(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const tenantId = req.body.tenantId || 'tenant1';
    const originalName = req.file.originalname;
    const fileExt = path.extname(originalName).toLowerCase().replace('.', '');
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const fileSize = req.file.size || req.file.buffer.length;

    // Validate supported formats
    const supportedTypes = ['pdf', 'docx', 'txt', 'md'];
    if (!supportedTypes.includes(fileExt)) {
      return res.status(400).json({
        error: `Unsupported file type: .${fileExt}. Supported types are: ${supportedTypes.join(', ')}`,
      });
    }

    // 1. Extract text from in-memory buffer
    const { text, metadata: extractedMeta } = await extractText(req.file.buffer, fileExt);

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Failed to extract text or file is empty' });
    }

    // 2. Store original binary file in MongoDB GridFS
    const fileId = await uploadBufferToGridFS(req.file.buffer, originalName, mimeType, {
      tenantId,
    });

    // 3. Persist Document record
    const document = await Document.create({
      tenantId,
      filename: originalName,
      fileType: fileExt,
      fileId,
      fileSize,
      mimeType,
      status: 'active',
      uploadedAt: new Date(),
    });

    // 4. Chunk text
    const rawChunks = createChunks(text, { chunkSize: 450, overlap: 50 });

    // 5. Tokenize and prepare chunk documents
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
          ...extractedMeta,
          ...chunk.metadata,
        },
      };
    });

    // 6. Bulk insert chunks
    if (chunkDocs.length > 0) {
      await Chunk.insertMany(chunkDocs);
    }

    // 7. Return summary response
    return res.status(201).json({
      message: 'Document stored in MongoDB and indexed successfully',
      documentId: document._id,
      fileId: document.fileId,
      filename: document.filename,
      chunksCreated: chunkDocs.length,
    });
  } catch (error) {
    console.error('[uploadDocument] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * List ingested documents for a tenant
 * GET /api/documents
 */
async function listDocuments(req, res) {
  try {
    const tenantId = req.query.tenantId || req.body.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId query parameter is required' });
    }

    const documents = await Document.find({ tenantId }).sort({ uploadedAt: -1 }).lean();
    return res.status(200).json({ documents });
  } catch (error) {
    console.error('[listDocuments] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * Download original file from MongoDB GridFS
 * GET /api/documents/:id/download
 */
async function downloadDocument(req, res) {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.set({
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(document.filename)}"`,
      'Content-Length': document.fileSize,
    });

    const downloadStream = getDownloadStream(document.fileId);

    downloadStream.on('error', (err) => {
      console.error('[downloadDocument] Stream error:', err);
      if (!res.headersSent) {
        res.status(404).json({ error: 'File not found in storage' });
      }
    });

    downloadStream.pipe(res);
  } catch (error) {
    console.error('[downloadDocument] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * Delete a document, its chunks, and the raw file in GridFS
 * DELETE /api/documents/:id
 */
async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 1. Delete binary file from GridFS
    if (document.fileId) {
      await deleteFromGridFS(document.fileId);
    }

    // 2. Cascade delete chunks
    await Chunk.deleteMany({ documentId: id });

    // 3. Delete document record
    await Document.findByIdAndDelete(id);

    return res.status(200).json({
      message: 'Document, associated chunks, and stored binary file deleted successfully',
      documentId: id,
    });
  } catch (error) {
    console.error('[deleteDocument] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

module.exports = {
  uploadDocument,
  listDocuments,
  downloadDocument,
  deleteDocument,
};

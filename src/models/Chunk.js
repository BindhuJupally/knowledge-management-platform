const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    tokens: {
      type: [String],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    embedding: {
      type: [Number],
      default: undefined,
    },
    embeddingModel: {
      type: String,
      trim: true,
    },
    embeddingVersion: {
      type: String,
      trim: true,
    },
    embeddedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for tenant-scoped chunk retrieval
chunkSchema.index({ tenantId: 1, documentId: 1 });

module.exports = mongoose.model('Chunk', chunkSchema);

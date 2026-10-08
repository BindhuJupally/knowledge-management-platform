const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    fileType: {
      type: String,
      required: true,
      enum: ['pdf', 'docx', 'txt', 'md', 'website'],
    },
    sourceUrl: {
      type: String,
      trim: true,
    },
    title: {
      type: String,
      trim: true,
    },
    crawlSessionId: {
      type: String,
      trim: true,
      index: true,
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'fs.files',
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    mimeType: {
      type: String,
      default: 'application/octet-stream',
    },
    status: {
      type: String,
      enum: ['active', 'processing', 'failed'],
      default: 'active',
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying documents by tenant
documentSchema.index({ tenantId: 1, uploadedAt: -1 });

module.exports = mongoose.model('Document', documentSchema);

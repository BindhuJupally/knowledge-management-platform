const express = require('express');
const multer = require('multer');
const {
  uploadDocument,
  listDocuments,
  deleteDocument,
  downloadDocument,
} = require('../controllers/document.controller');
const { crawlAndIngestWebsite } = require('../controllers/website.controller');

const router = express.Router();

// In-memory Multer storage (no temporary files saved to disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB limit
  },
});

router.post('/', upload.single('file'), uploadDocument);
router.post('/website', crawlAndIngestWebsite);
router.get('/', listDocuments);
router.get('/:id/download', downloadDocument);
router.delete('/:id', deleteDocument);

module.exports = router;

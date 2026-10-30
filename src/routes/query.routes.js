const express = require('express');
const { queryChunks, querySemanticChunks } = require('../controllers/query.controller');

const router = express.Router();

router.post('/', queryChunks);
router.post('/semantic', querySemanticChunks);

module.exports = router;

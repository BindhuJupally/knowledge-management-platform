const express = require('express');
const { queryChunks } = require('../controllers/query.controller');

const router = express.Router();

router.post('/', queryChunks);

module.exports = router;

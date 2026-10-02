const express = require('express');
const cors = require('cors');

const documentRoutes = require('./routes/document.routes');
const queryRoutes = require('./routes/query.routes');

const app = express();

// Standard middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Mount API routes
app.use('/api/documents', documentRoutes);
app.use('/api/query', queryRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

module.exports = app;

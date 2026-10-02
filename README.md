# Knowledge Management Platform

A multi-tenant knowledge management and retrieval platform. **Phase 1** establishes a measurable lexical-retrieval baseline using **Node.js, Express, MongoDB (GridFS), and native Okapi BM25 ranking**.

---

## Architecture Overview

```
                      +-----------------------------+
                      |   Client (Postman / App)    |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |       Express.js API        |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               |                                           |
               v                                           v
    [ Ingestion Pipeline ]                      [ Retrieval Pipeline ]
    • Memory buffer upload (Multer)             • Tokenize natural-language query
    • Extract text (PDF, DOCX, TXT, MD)         • Fetch tenant chunks from MongoDB
    • Store raw file in MongoDB GridFS          • In-memory Okapi BM25 calculation
    • Word chunking (450w, 50w overlap)         • Sort by relevance score descending
    • Tokenize & normalize                      • Return top-k evidence passages
    • Store chunks in MongoDB                   
               |                                           |
               +---------------------+---------------------+
                                     |
                                     v
                      +-----------------------------+
                      |      MongoDB Database       |
                      |  • Documents metadata       |
                      |  • Chunks & tokens          |
                      |  • GridFS binary storage    |
                      +-----------------------------+
```

---

## Key Features

- **Multi-Tenancy from Day 1**: Strict tenant scoping (`tenantId`) enforced across all documents, chunks, and query searches.
- **In-Memory Buffer Processing**: Uploaded files are processed directly in RAM buffers—no temporary scratch files are written to local disk.
- **Full Binary Persistence (MongoDB GridFS)**: Original files (`.pdf`, `.docx`, `.txt`, `.md`) are persisted directly in MongoDB GridFS and can be downloaded back at any time.
- **Multi-Format Text Extraction**:
  - **PDF**: `pdf-parse`
  - **Word**: `mammoth`
  - **Text / Markdown**: UTF-8 stream decoding
- **Sliding-Window Chunking**: 450-word chunks with a 50-word overlap to ensure search queries preserve contextual boundaries across paragraphs.
- **Native Okapi BM25 Retrieval**: Transparent, self-contained implementation of the Robertson-Spärck Jones Okapi BM25 algorithm ($k_1=1.5, b=0.75$) with no external search cluster dependencies.

---

## Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/) (v20+)
- **API Framework**: [Express.js](https://expressjs.com/)
- **Database & ODM**: [MongoDB](https://www.mongodb.com/) & [Mongoose](https://mongoosejs.com/) (GridFS)
- **File Uploads**: [Multer](https://github.com/expressjs/multer) (`memoryStorage`)
- **Document Extractors**: `pdf-parse`, `mammoth`
- **Testing**: [Jest](https://jestjs.io/) & [Supertest](https://github.com/ladjs/supertest)

---

## Project Structure

```
knowledge-management-platform/
│
├── src/
│   ├── app.js                     # Express app configuration & middleware
│   ├── server.js                  # Entry point (MongoDB connection & port listening)
│   │
│   ├── config/
│   │   └── db.js                  # Database connection handler
│   │
│   ├── models/
│   │   ├── Document.js            # Mongoose schema for document metadata
│   │   └── Chunk.js               # Mongoose schema for text chunks & tokens
│   │
│   ├── controllers/
│   │   ├── document.controller.js # Upload, listing, download, and deletion
│   │   └── query.controller.js    # BM25 query retrieval
│   │
│   ├── routes/
│   │   ├── document.routes.js     # /api/documents routes
│   │   └── query.routes.js        # /api/query routes
│   │
│   ├── services/
│   │   ├── extraction.service.js  # Buffer-based text extraction
│   │   ├── chunking.service.js    # Sliding window chunking logic
│   │   ├── gridfs.service.js      # MongoDB GridFS upload/download/delete
│   │   └── retrieval.service.js   # Native Okapi BM25 retrieval engine
│   │
│   └── utils/
│       └── tokenizer.js           # Text normalization and tokenization
│
├── tests/                         # Unit tests (Jest)
│   ├── tokenizer.test.js
│   ├── chunking.test.js
│   └── extraction.test.js
│
├── .env                           # Environment variables
├── .gitignore
└── package.json
```

---

## Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or v20+)
- MongoDB instance (local or MongoDB Atlas)

### 2. Environment Configuration
Create a `.env` file in the project root:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.example.mongodb.net/knowledge-management-platform
```

### 3. Installation
```bash
npm install
```

### 4. Running the Application
```bash
# Production / standard start
npm start

# Development mode (auto-reload on changes via nodemon)
npm run dev

# Run unit tests
npm test
```

---

## API Documentation

### 1. Ingest Document
Uploads a document, extracts text, chunks and tokenizes content, and stores the original binary file in MongoDB GridFS.

- **Method**: `POST`
- **Endpoint**: `/api/documents`
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `file`: File (`.pdf`, `.docx`, `.txt`, `.md`)
  - `tenantId`: String (e.g. `tenant1`)

**Example Response (`201 Created`):**
```json
{
  "message": "Document stored in MongoDB and indexed successfully",
  "documentId": "65b7a1c4e92a40775441a635",
  "fileId": "65b7a1c5e92a40775441a636",
  "filename": "academic_regulations.pdf",
  "chunksCreated": 14
}
```

---

### 2. Query Evidence Chunks (BM25 Retrieval)
Executes a lexical BM25 query across all document chunks belonging to the specified tenant.

- **Method**: `POST`
- **Endpoint**: `/api/query`
- **Content-Type**: `application/json`
- **Body**:
```json
{
  "tenantId": "tenant1",
  "query": "credits for Applied Physics",
  "topK": 3
}
```

**Example Response (`200 OK`):**
```json
{
  "query": "credits for Applied Physics",
  "results": [
    {
      "chunkId": "65b7a1c5e92a40775441a665",
      "documentId": "65b7a1c4e92a40775441a635",
      "score": 8.0922,
      "text": "Code Title L T P Credits 2 PH202BS Applied Physics 3 1 0 4...",
      "metadata": {
        "startWordIndex": 13200,
        "endWordIndex": 13650,
        "numpages": 222
      }
    }
  ]
}
```

---

### 3. List Documents
Returns all active documents for a given tenant.

- **Method**: `GET`
- **Endpoint**: `/api/documents?tenantId=tenant1`

**Example Response (`200 OK`):**
```json
{
  "documents": [
    {
      "_id": "65b7a1c4e92a40775441a635",
      "tenantId": "tenant1",
      "filename": "academic_regulations.pdf",
      "fileType": "pdf",
      "fileSize": 1845200,
      "mimeType": "application/pdf",
      "status": "active",
      "uploadedAt": "2026-10-02T08:10:00.000Z"
    }
  ]
}
```

---

### 4. Download Original Document
Streams the original binary file directly out of MongoDB GridFS.

- **Method**: `GET`
- **Endpoint**: `/api/documents/:id/download`
- **Response**: Binary file stream with original `Content-Type` and `Content-Disposition`.

---

### 5. Delete Document
Deletes the document metadata, cascades chunk deletion, and purges the binary file from GridFS.

- **Method**: `DELETE`
- **Endpoint**: `/api/documents/:id`

**Example Response (`200 OK`):**
```json
{
  "message": "Document, associated chunks, and stored binary file deleted successfully",
  "documentId": "65b7a1c4e92a40775441a635"
}
```

---

## Roadmap

- **Phase 1** *(Current)*: Lexical retrieval baseline (BM25), MongoDB persistence, and GridFS storage.
- **Phase 2**: Dense vector embeddings and similarity search.
- **Phase 3**: Quantitative evaluation comparing Lexical (BM25) vs Dense Vector retrieval.
- **Phase 4**: Hybrid retrieval (Reciprocal Rank Fusion / Alpha blending).
- **Phase 5**: Cross-encoder reranking.
- **Phase 6**: Knowledge graph entity/relation extraction and graph traversal.
- **Phase 7**: Document versioning, supersession chains, and temporal validity filtering.
- **Phase 8**: Answer synthesis with citations, RBAC, and UI.

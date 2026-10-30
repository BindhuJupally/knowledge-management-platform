require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const embeddingService = require('../services/embedding.service');
const {
  retrieveIndexedVectorChunks,
  retrieveExactScanChunks,
} = require('../services/semanticRetrieval.service');

const TEST_QUERIES = [
  'computer science and software engineering curriculum',
  'operating systems device and memory management',
  'database management systems relational models and SQL',
  'engineering physics laboratory experiments and syllabus',
  'network protocols wireless communication and cyber security',
];

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function computeRecallAtK(retrievedList, groundTruthList, k) {
  const topRetrieved = new Set(retrievedList.slice(0, k).map((item) => String(item.chunkId)));
  const topGroundTruth = groundTruthList.slice(0, k).map((item) => String(item.chunkId));
  if (topGroundTruth.length === 0) return 1.0;
  let matches = 0;
  for (const id of topGroundTruth) {
    if (topRetrieved.has(id)) matches++;
  }
  return matches / topGroundTruth.length;
}

async function runValidation() {
  await connectDB();
  const tenantId = 'tenant1';
  const modelInfo = embeddingService.getModelInfo();

  console.log('='.repeat(70));
  console.log(`Phase 2 Semantic Search Performance & Correctness Validation`);
  console.log(`Tenant: ${tenantId} | Model: ${modelInfo.model} | Dim: ${modelInfo.dimension}`);
  console.log('='.repeat(70));

  const candidateSettings = [50, 100, 200];
  const embeddingLatencies = [];
  const exhaustiveLatencies = [];
  const indexedLatenciesByCandidates = { 50: [], 100: [], 200: [] };
  const recall5ByCandidates = { 50: [], 100: [], 200: [] };
  const recall10ByCandidates = { 50: [], 100: [], 200: [] };

  for (const query of TEST_QUERIES) {
    console.log(`\nEvaluating Query: "${query}"`);

    // 1. Measure Query Embedding Latency
    const t0 = performance.now();
    const queryVector = await embeddingService.embedText(query);
    const t1 = performance.now();
    const embedLatency = t1 - t0;
    embeddingLatencies.push(embedLatency);

    // 2. Measure Ground Truth (Exhaustive Scan)
    const t2 = performance.now();
    const groundTruth = await retrieveExactScanChunks({
      tenantId,
      embeddingModel: modelInfo.model,
      queryVector,
      topK: 10,
    });
    const t3 = performance.now();
    const exhaustiveLatency = t3 - t2;
    exhaustiveLatencies.push(exhaustiveLatency);

    console.log(`  Query Embed Latency: ${embedLatency.toFixed(2)} ms`);
    console.log(`  Exhaustive Scan Latency: ${exhaustiveLatency.toFixed(2)} ms (chunks: ${groundTruth.length})`);

    // 3. Measure Indexed Search with various numCandidates
    for (const numCandidates of candidateSettings) {
      const t4 = performance.now();
      const indexedResults = await retrieveIndexedVectorChunks({
        tenantId,
        embeddingModel: modelInfo.model,
        queryVector,
        topK: 10,
        numCandidates,
      });
      const t5 = performance.now();
      const idxLatency = t5 - t4;

      const r5 = computeRecallAtK(indexedResults, groundTruth, 5);
      const r10 = computeRecallAtK(indexedResults, groundTruth, 10);

      indexedLatenciesByCandidates[numCandidates].push(idxLatency);
      recall5ByCandidates[numCandidates].push(r5);
      recall10ByCandidates[numCandidates].push(r10);

      console.log(
        `  Indexed (numCandidates=${numCandidates}): Latency=${idxLatency.toFixed(2)} ms | Recall@5=${(r5 * 100).toFixed(0)}% | Recall@10=${(r10 * 100).toFixed(0)}%`
      );
    }
  }

  // Summary Report
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY PERFORMANCE & RECALL REPORT');
  console.log('='.repeat(70));

  console.log(`Query Embedding Latency (Cohere API):`);
  console.log(`  p50: ${percentile(embeddingLatencies, 50).toFixed(2)} ms | p95: ${percentile(embeddingLatencies, 95).toFixed(2)} ms`);

  console.log(`\nExhaustive Cosine Scan Latency (Ground Truth):`);
  console.log(`  p50: ${percentile(exhaustiveLatencies, 50).toFixed(2)} ms | p95: ${percentile(exhaustiveLatencies, 95).toFixed(2)} ms`);

  console.log(`\nIndexed Atlas Vector Search ($vectorSearch):`);
  for (const numCandidates of candidateSettings) {
    const latencies = indexedLatenciesByCandidates[numCandidates];
    const r5List = recall5ByCandidates[numCandidates];
    const r10List = recall10ByCandidates[numCandidates];
    const avgR5 = r5List.reduce((a, b) => a + b, 0) / r5List.length;
    const avgR10 = r10List.reduce((a, b) => a + b, 0) / r10List.length;

    console.log(`  numCandidates=${numCandidates}:`);
    console.log(`    Latency: p50=${percentile(latencies, 50).toFixed(2)} ms, p95=${percentile(latencies, 95).toFixed(2)} ms`);
    console.log(`    Accuracy: Mean Recall@5=${(avgR5 * 100).toFixed(1)}%, Mean Recall@10=${(avgR10 * 100).toFixed(1)}%`);
  }

  console.log('='.repeat(70));
  await mongoose.disconnect();
}

if (require.main === module) {
  runValidation().catch((err) => {
    console.error('Validation failed:', err);
    process.exit(1);
  });
}

module.exports = runValidation;

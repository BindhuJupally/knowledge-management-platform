const { createChunks } = require('../src/services/chunking.service');

describe('Chunking Service', () => {
  test('should return empty array for empty or invalid text', () => {
    expect(createChunks('')).toEqual([]);
    expect(createChunks(null)).toEqual([]);
    expect(createChunks('   ')).toEqual([]);
  });

  test('should create a single chunk if text is smaller than chunkSize', () => {
    const text = 'This is a brief policy document about vacation days.';
    const chunks = createChunks(text, { chunkSize: 50, overlap: 10 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].text).toBe(text);
  });

  test('should create multiple overlapping chunks for longer text', () => {
    // 20 words
    const words = Array.from({ length: 20 }, (_, i) => `word${i + 1}`);
    const text = words.join(' ');

    // Chunk size 10, overlap 2 -> step 8
    // Chunk 0: words 0..9 (10 words)
    // Chunk 1: words 8..17 (10 words)
    // Chunk 2: words 16..19 (4 words)
    const chunks = createChunks(text, { chunkSize: 10, overlap: 2 });
    expect(chunks.length).toBe(3);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].metadata.startWordIndex).toBe(0);
    expect(chunks[0].metadata.endWordIndex).toBe(10);

    expect(chunks[1].chunkIndex).toBe(1);
    expect(chunks[1].metadata.startWordIndex).toBe(8);
    expect(chunks[1].metadata.endWordIndex).toBe(18);

    expect(chunks[2].chunkIndex).toBe(2);
    expect(chunks[2].metadata.startWordIndex).toBe(16);
    expect(chunks[2].metadata.endWordIndex).toBe(20);
  });
});

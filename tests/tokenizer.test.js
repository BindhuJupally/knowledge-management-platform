const { tokenize } = require('../src/utils/tokenizer');

describe('Tokenizer Utility', () => {
  test('should lowercase text and split words', () => {
    const input = 'Hello World! This is a test.';
    const tokens = tokenize(input);
    expect(tokens).toEqual(['hello', 'world', 'this', 'is', 'a', 'test']);
  });

  test('should strip punctuation and special characters', () => {
    const input = 'Lexical-retrieval baseline: (BM25) @2026!';
    const tokens = tokenize(input);
    expect(tokens).toEqual(['lexical', 'retrieval', 'baseline', 'bm25', '2026']);
  });

  test('should handle empty or null input gracefully', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });

  test('should filter stop words when enabled', () => {
    const input = 'How many leave days do interns get?';
    const tokensWithoutStopWords = tokenize(input, true);
    expect(tokensWithoutStopWords).toEqual(['many', 'leave', 'days', 'interns', 'get']);
  });
});

const { extractText } = require('../src/services/extraction.service');

describe('Extraction Service (Buffer-based)', () => {
  test('should extract text from a plain text buffer', async () => {
    const rawContent = 'Annual leave is 20 days per year for full-time employees.';
    const buffer = Buffer.from(rawContent, 'utf-8');

    const result = await extractText(buffer, 'txt');
    expect(result.text).toBe(rawContent);
  });

  test('should extract text from a markdown buffer', async () => {
    const rawContent = '# Remote Work Policy\nEmployees may work remotely 2 days per week.';
    const buffer = Buffer.from(rawContent, 'utf-8');

    const result = await extractText(buffer, 'md');
    expect(result.text).toBe(rawContent);
  });

  test('should throw error for unsupported file types', async () => {
    const buffer = Buffer.from('some data', 'utf-8');
    await expect(extractText(buffer, 'exe')).rejects.toThrow('Unsupported file type: exe');
  });

  test('should throw error if input is not a buffer', async () => {
    await expect(extractText('not a buffer', 'txt')).rejects.toThrow(
      'Expected buffer for text extraction'
    );
  });
});

/**
 * Unit tests for Clio Viewer logic
 */
const {
  validateConversation,
  formatSize,
  formatDate,
  checkFileSize,
  checkFilename,
  FILE_SIZE_WARNING,
  FILE_SIZE_LIMIT
} = require('../viewer/viewer-logic');

// Load test fixtures
const validConversation = require('./fixtures/conversation_fixture.json');
const brokenFixture = require('./fixtures/broken_fixture.json');
const emptyTurns = require('./fixtures/empty_turns_fixture.json');
const missingMetadata = require('./fixtures/missing_metadata_fixture.json');
const largeContent = require('./fixtures/large_content_fixture.json');

describe('validateConversation', () => {
  test('accepts valid conversation', () => {
    expect(() => validateConversation(validConversation)).not.toThrow();
    expect(validateConversation(validConversation)).toBe(true);
  });

  test('accepts conversation with empty turns array', () => {
    expect(() => validateConversation(emptyTurns)).not.toThrow();
  });

  test('accepts conversation with large content', () => {
    expect(() => validateConversation(largeContent)).not.toThrow();
  });

  test('rejects null input', () => {
    expect(() => validateConversation(null))
      .toThrow('Invalid JSON: not an object');
  });

  test('rejects non-object input', () => {
    expect(() => validateConversation('string'))
      .toThrow('Invalid JSON: not an object');
    expect(() => validateConversation(123))
      .toThrow('Invalid JSON: not an object');
    expect(() => validateConversation([]))
      .toThrow('Missing or invalid metadata');
  });

  test('rejects missing metadata', () => {
    expect(() => validateConversation(missingMetadata))
      .toThrow('Missing or invalid metadata');
  });

  test('rejects non-object metadata', () => {
    expect(() => validateConversation({ metadata: 'string', messages: [] }))
      .toThrow('Missing or invalid metadata');
  });

  test('rejects non-array messages', () => {
    expect(() => validateConversation(brokenFixture))
      .toThrow('Missing or invalid messages array');
  });

  test('rejects invalid role', () => {
    const badRole = {
      metadata: { title: 'test' },
      messages: [{ role: 'unknown', content: 'hello' }]
    };
    expect(() => validateConversation(badRole))
      .toThrow('Turn 0: invalid role "unknown"');
  });

  test('rejects missing role', () => {
    const noRole = {
      metadata: { title: 'test' },
      messages: [{ content: 'hello' }]
    };
    expect(() => validateConversation(noRole))
      .toThrow('Turn 0: invalid role');
  });

  test('rejects missing content', () => {
    const noContent = {
      metadata: { title: 'test' },
      messages: [{ role: 'user' }]
    };
    expect(() => validateConversation(noContent))
      .toThrow('Turn 0: content must be string');
  });

  test('rejects non-string content', () => {
    const numContent = {
      metadata: { title: 'test' },
      messages: [{ role: 'user', content: 123 }]
    };
    expect(() => validateConversation(numContent))
      .toThrow('Turn 0: content must be string');
  });

  test('reports correct turn index on error', () => {
    const badThirdTurn = {
      metadata: { title: 'test' },
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'invalid', content: 'third' }
      ]
    };
    expect(() => validateConversation(badThirdTurn))
      .toThrow('Turn 2: invalid role "invalid"');
  });
});

describe('formatSize', () => {
  test('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  test('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(102400)).toBe('100.0 KB');
  });

  test('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(5242880)).toBe('5.0 MB');
  });
});

describe('formatDate', () => {
  test('formats valid ISO date', () => {
    const result = formatDate('2026-01-19T12:00:00.000Z');
    // Result depends on locale, just check it's not the fallback
    expect(result).not.toBe('Unknown date');
    expect(result).not.toBe('Invalid date');
  });

  test('returns Unknown date for null', () => {
    expect(formatDate(null)).toBe('Unknown date');
  });

  test('returns Unknown date for undefined', () => {
    expect(formatDate(undefined)).toBe('Unknown date');
  });

  test('returns Unknown date for empty string', () => {
    expect(formatDate('')).toBe('Unknown date');
  });
});

describe('checkFileSize', () => {
  test('accepts small files', () => {
    const result = checkFileSize(1024);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe(false);
    expect(result.error).toBeNull();
  });

  test('warns for files over 5MB', () => {
    const result = checkFileSize(FILE_SIZE_WARNING + 1);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.error).toBeNull();
  });

  test('rejects files over 20MB', () => {
    const result = checkFileSize(FILE_SIZE_LIMIT + 1);
    expect(result.valid).toBe(false);
    expect(result.warning).toBe(false);
    expect(result.error).toContain('20MB limit');
  });

  test('boundary: exactly 5MB is not a warning', () => {
    const result = checkFileSize(FILE_SIZE_WARNING);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe(false);
  });

  test('boundary: exactly 20MB is not rejected', () => {
    const result = checkFileSize(FILE_SIZE_LIMIT);
    expect(result.valid).toBe(true);
    // It's a warning since it's over 5MB
    expect(result.warning).toBe(true);
  });
});

describe('checkFilename', () => {
  test('accepts .json files', () => {
    expect(checkFilename('test.json').valid).toBe(true);
    expect(checkFilename('conversation_fixture.json').valid).toBe(true);
    expect(checkFilename('my-file.JSON').valid).toBe(false); // Case sensitive
  });

  test('rejects non-json files', () => {
    const result = checkFilename('test.zip');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.json');
  });

  test('rejects files without extension', () => {
    expect(checkFilename('testjson').valid).toBe(false);
  });
});

describe('constants', () => {
  test('FILE_SIZE_WARNING is 5MB', () => {
    expect(FILE_SIZE_WARNING).toBe(5 * 1024 * 1024);
  });

  test('FILE_SIZE_LIMIT is 20MB', () => {
    expect(FILE_SIZE_LIMIT).toBe(20 * 1024 * 1024);
  });
});

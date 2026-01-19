/**
 * Unit tests for content.js extraction functions.
 *
 * LLD Reference: docs/reports/1/lld-clio.md Section 11.1
 */

const {
  sanitizeFilename,
  extractTitle,
  extractConversationId,
  extractTextContent,
  extractUserTurn,
  extractAssistantTurn,
  validateSelectors,
  isStreaming
} = require('../extension/src/content.js');

const { SELECTORS } = require('../extension/src/selectors.js');

// Make SELECTORS available globally for content.js
global.SELECTORS = SELECTORS;

describe('sanitizeFilename', () => {
  // Test ID: 070
  test('removes illegal filesystem characters', () => {
    expect(sanitizeFilename('test/file:name*.txt')).toBe('test_file_name_.txt');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeFilename('my file name.txt')).toBe('my_file_name.txt');
  });

  test('collapses multiple underscores', () => {
    expect(sanitizeFilename('test///file')).toBe('test_file');
  });

  test('handles empty input', () => {
    expect(sanitizeFilename('')).toBe('untitled');
    expect(sanitizeFilename(null)).toBe('untitled');
    expect(sanitizeFilename(undefined)).toBe('untitled');
  });

  test('truncates long filenames', () => {
    const longName = 'a'.repeat(300);
    expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(200);
  });

  test('removes all dangerous characters', () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe('file_name');
  });
});

describe('extractTitle', () => {
  // Test ID: 020
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('extracts title from h1 with data attribute', () => {
    document.body.innerHTML = '<h1 data-conversation-title>Test Chat</h1>';
    expect(extractTitle()).toBe('Test Chat');
  });

  test('extracts title from h1 with class', () => {
    document.body.innerHTML = '<h1 class="conversation-title">My Conversation</h1>';
    expect(extractTitle()).toBe('My Conversation');
  });

  test('falls back to any h1', () => {
    document.body.innerHTML = '<h1>Fallback Title</h1>';
    expect(extractTitle()).toBe('Fallback Title');
  });

  test('falls back to document title', () => {
    document.body.innerHTML = '<div>No h1 here</div>';
    document.title = 'Page Title - Gemini';
    expect(extractTitle()).toBe('Page Title');
  });

  test('returns default for empty page', () => {
    document.body.innerHTML = '';
    document.title = '';
    expect(extractTitle()).toBe('Untitled Conversation');
  });
});

describe('extractConversationId', () => {
  const originalLocation = window.location;

  afterEach(() => {
    delete window.location;
    window.location = originalLocation;
  });

  test('extracts ID from Gemini URL', () => {
    delete window.location;
    window.location = { pathname: '/app/efdb7649143fefda' };
    expect(extractConversationId()).toBe('efdb7649143fefda');
  });

  test('returns unknown for non-matching URL', () => {
    delete window.location;
    window.location = { pathname: '/settings' };
    expect(extractConversationId()).toBe('unknown');
  });
});

describe('validateSelectors', () => {
  // Test ID: 090
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns valid when conversation container exists', () => {
    document.body.innerHTML = `
      <main data-conversation-id="test123">
        <div data-message-author-role="user">Hello</div>
      </main>
    `;
    const result = validateSelectors();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('returns invalid when container missing', () => {
    document.body.innerHTML = '<div>No conversation here</div>';
    const result = validateSelectors();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('conversationContainer');
  });
});

describe('isStreaming', () => {
  // Test ID: 085
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns true when Stop button present', () => {
    document.body.innerHTML = '<button>Stop</button>';
    // Note: :has-text is not supported in jsdom, so we test with class
    document.body.innerHTML = '<button class="streaming-indicator">Stop</button>';
    expect(isStreaming()).toBe(true);
  });

  test('returns false when no streaming indicators', () => {
    document.body.innerHTML = '<button>Send</button>';
    expect(isStreaming()).toBe(false);
  });
});

describe('extractTextContent', () => {
  test('extracts plain text', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Hello, World!';
    expect(extractTextContent(div)).toBe('Hello, World!');
  });

  test('preserves code blocks with markdown formatting', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Here is code:</p><pre><code data-language="python">print("hello")</code></pre>';
    const result = extractTextContent(div);
    expect(result).toContain('```python');
    expect(result).toContain('print("hello")');
    expect(result).toContain('```');
  });

  test('handles nested elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p><strong>Bold</strong> and <em>italic</em></p>';
    expect(extractTextContent(div)).toBe('Bold and italic');
  });

  test('handles empty element', () => {
    const div = document.createElement('div');
    expect(extractTextContent(div)).toBe('');
  });
});

describe('extractUserTurn', () => {
  // Test ID: 010
  test('extracts user message content', () => {
    const div = document.createElement('div');
    div.innerHTML = 'This is my question to you.';

    const turn = extractUserTurn(div, 0);

    expect(turn.index).toBe(0);
    expect(turn.role).toBe('user');
    expect(turn.content).toBe('This is my question to you.');
    expect(turn.thinking).toBeNull();
    expect(turn.attachments).toEqual([]);
  });

  test('extracts images from user message', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Check this: <img src="data:image/png;base64,abc123">';

    const turn = extractUserTurn(div, 1);

    expect(turn.attachments).toHaveLength(1);
    expect(turn.attachments[0].type).toBe('image');
    expect(turn.attachments[0].originalSrc).toBe('data:image/png;base64,abc123');
  });
});

describe('extractAssistantTurn', () => {
  // Test ID: 040
  test('extracts assistant message with thinking', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="thinking-content">My internal thoughts...</div>
      <div class="response-container">Here is my response to you.</div>
    `;

    const turn = extractAssistantTurn(div, 1);

    expect(turn.index).toBe(1);
    expect(turn.role).toBe('assistant');
    expect(turn.content).toContain('Here is my response to you.');
    expect(turn.thinking).toBe('My internal thoughts...');
  });

  test('handles assistant message without thinking', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div class="response-container">Simple response.</div>';

    const turn = extractAssistantTurn(div, 0);

    expect(turn.thinking).toBeNull();
    expect(turn.content).toContain('Simple response.');
  });

  // Test ID: 050
  test('preserves code blocks in response', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="response-container">
        Here's the code:
        <pre><code data-language="javascript">console.log("test");</code></pre>
      </div>
    `;

    const turn = extractAssistantTurn(div, 0);

    expect(turn.content).toContain('```javascript');
    expect(turn.content).toContain('console.log("test")');
  });
});

describe('fixture-based extraction', () => {
  // Test ID: 010 (full extraction)
  beforeEach(() => {
    setFixture('gemini-conversation.html');
  });

  test('validates selectors on fixture', () => {
    const result = validateSelectors();
    expect(result.valid).toBe(true);
  });

  test('extracts title from fixture', () => {
    expect(extractTitle()).toBe('Test Conversation Title');
  });

  test('fixture has expected structure', () => {
    const messages = document.querySelectorAll('[data-message-author-role]');
    expect(messages.length).toBe(4); // 2 user + 2 assistant
  });
});

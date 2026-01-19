/**
 * Integration tests for full conversation extraction flow.
 *
 * LLD Reference: docs/reports/1/lld-clio.md Section 11.2
 */

const {
  sanitizeFilename,
  extractTitle,
  extractConversationId,
  extractTextContent,
  extractUserTurn,
  extractAssistantTurn,
  validateSelectors,
  isStreaming,
  extractTurns,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../../extension/src/content.js');

const { SELECTORS } = require('../../extension/src/selectors.js');

// Make SELECTORS available globally for content.js
global.SELECTORS = SELECTORS;

// Fast config for tests to avoid timeouts
const FAST_SCROLL_CONFIG = {
  scrollStep: 100,
  scrollDelay: 10,
  mutationTimeout: 50,
  maxScrollAttempts: 20,
  loadingCheckInterval: 10,
  maxLoadingWait: 100,
  progressUpdateInterval: 2
};

describe('Full Extraction Integration', () => {
  beforeEach(() => {
    setScrollConfig(FAST_SCROLL_CONFIG);
    setFixture('gemini-conversation.html');
  });

  afterEach(() => {
    resetScrollConfig();
  });

  // Test ID: INT-010
  test('extracts complete conversation with all turns in order', () => {
    // Use data-message-author-role to find turns (most specific selector)
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    const assistantMessages = document.querySelectorAll('[data-message-author-role="model"]');

    // Verify fixture structure
    expect(userMessages.length).toBe(2);
    expect(assistantMessages.length).toBe(2);

    // Extract turns using the allMessages selector to get DOM order
    const allTurns = document.querySelectorAll('[data-message-author-role]');
    expect(allTurns.length).toBe(4);

    // Verify alternating pattern (user, assistant, user, assistant)
    const roles = Array.from(allTurns).map(el =>
      el.getAttribute('data-message-author-role')
    );
    expect(roles).toEqual(['user', 'model', 'user', 'model']);
  });

  // Test ID: INT-020
  test('extracts user turn content correctly', () => {
    const userTurns = document.querySelectorAll(SELECTORS.userMessage);
    const firstUserTurn = userTurns[0].closest('[data-message-author-role]');

    const turn = extractUserTurn(firstUserTurn, 0);

    expect(turn.role).toBe('user');
    expect(turn.index).toBe(0);
    expect(turn.content).toContain('Hello, this is my first message');
    expect(turn.attachments).toEqual([]);
  });

  // Test ID: INT-030
  test('extracts user turn with image attachment', () => {
    const userTurns = document.querySelectorAll('[data-message-author-role="user"]');
    const secondUserTurn = userTurns[1];

    const turn = extractUserTurn(secondUserTurn, 2);

    expect(turn.role).toBe('user');
    expect(turn.content).toContain('Thanks!');
    expect(turn.attachments.length).toBe(1);
    expect(turn.attachments[0].type).toBe('image');
    expect(turn.attachments[0].originalSrc).toContain('data:image/png;base64');
  });

  // Test ID: INT-040
  test('extracts assistant turn with code block', () => {
    const assistantTurns = document.querySelectorAll('[data-message-author-role="model"]');
    const firstAssistant = assistantTurns[0];

    const turn = extractAssistantTurn(firstAssistant, 1);

    expect(turn.role).toBe('assistant');
    expect(turn.content).toContain('```python');
    expect(turn.content).toContain('def hello_world():');
    expect(turn.content).toContain('print("Hello, World!")');
    expect(turn.content).toContain('```');
    expect(turn.thinking).toBeNull();
  });

  // Test ID: INT-050
  test('extracts assistant turn with thinking content', () => {
    const assistantTurns = document.querySelectorAll('[data-message-author-role="model"]');
    const secondAssistant = assistantTurns[1];

    const turn = extractAssistantTurn(secondAssistant, 3);

    expect(turn.role).toBe('assistant');
    expect(turn.thinking).not.toBeNull();
    expect(turn.thinking).toContain('Let me analyze this image');
    expect(turn.content).toContain('1x1 pixel PNG');
  });

  // Test ID: INT-060
  test('extractTurns returns all turns in correct order', async () => {
    const turns = await extractTurns();

    expect(turns.length).toBe(4);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
    expect(turns[2].role).toBe('user');
    expect(turns[3].role).toBe('assistant');

    // Verify indices
    expect(turns[0].index).toBe(0);
    expect(turns[1].index).toBe(1);
    expect(turns[2].index).toBe(2);
    expect(turns[3].index).toBe(3);
  });

  // Test ID: INT-070
  test('extractConversation returns complete structured data', async () => {
    const result = await extractConversation();

    // Verify success
    expect(result.success).toBe(true);

    // Verify metadata structure (exact conversationId is tested in unit tests)
    expect(result.data.metadata).toBeDefined();
    expect(typeof result.data.metadata.conversationId).toBe('string');
    expect(result.data.metadata.title).toBe('Test Conversation Title');
    expect(result.data.metadata.extractedAt).toBeDefined();
    expect(result.data.metadata.url).toBeDefined();

    // Verify turns
    expect(result.data.turns.length).toBe(4);

    // Verify images array exists
    expect(result.images).toBeDefined();
    expect(Array.isArray(result.images)).toBe(true);
  });
});

describe('JSON Schema Compliance', () => {
  beforeEach(() => {
    setScrollConfig(FAST_SCROLL_CONFIG);
    setFixture('gemini-conversation.html');
  });

  afterEach(() => {
    resetScrollConfig();
  });

  // Test ID: INT-080
  test('conversation JSON has required metadata fields', async () => {
    const result = await extractConversation();
    expect(result.success).toBe(true);

    const requiredMetadataFields = ['conversationId', 'title', 'extractedAt', 'url'];
    for (const field of requiredMetadataFields) {
      expect(result.data.metadata).toHaveProperty(field);
    }
  });

  // Test ID: INT-090
  test('each turn has required fields', async () => {
    const result = await extractConversation();
    expect(result.success).toBe(true);

    const requiredTurnFields = ['index', 'role', 'content', 'attachments'];
    for (const turn of result.data.turns) {
      for (const field of requiredTurnFields) {
        expect(turn).toHaveProperty(field);
      }
    }
  });

  // Test ID: INT-100
  test('assistant turns can have thinking field', async () => {
    const result = await extractConversation();
    expect(result.success).toBe(true);

    const assistantTurns = result.data.turns.filter(t => t.role === 'assistant');
    expect(assistantTurns.length).toBe(2);

    // Second assistant turn has thinking
    const turnWithThinking = assistantTurns[1];
    expect(turnWithThinking.thinking).not.toBeNull();
  });

  // Test ID: INT-110
  test('attachments have correct structure', async () => {
    const result = await extractConversation();
    expect(result.success).toBe(true);

    // Find turn with image attachment
    const turnWithImage = result.data.turns.find(t => t.attachments.length > 0);
    expect(turnWithImage).toBeDefined();

    const attachment = turnWithImage.attachments[0];
    expect(attachment).toHaveProperty('type');
    expect(attachment).toHaveProperty('originalSrc');
    expect(attachment.type).toBe('image');
  });
});

describe('Edge Cases and Error Handling', () => {
  beforeEach(() => {
    setScrollConfig(FAST_SCROLL_CONFIG);
  });

  afterEach(() => {
    resetScrollConfig();
  });

  // Test ID: INT-120
  test('handles page without messages as validation failure', async () => {
    // A page with no conversation messages should fail validation
    document.body.innerHTML = '<main data-conversation-id="empty"></main>';
    const originalLocation = window.location;
    delete window.location;
    window.location = {
      pathname: '/app/empty',
      href: 'https://gemini.google.com/app/empty'
    };

    const result = await extractConversation();

    // Restore location
    delete window.location;
    window.location = originalLocation;

    // Should fail validation because no messages exist
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing selectors');
  });

  // Test ID: INT-130
  test('handles missing thinking section', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div class="response-container">Simple response without thinking.</div>';

    const turn = extractAssistantTurn(div, 0);

    expect(turn.thinking).toBeNull();
    expect(turn.content).toContain('Simple response');
  });

  // Test ID: INT-140
  test('handles code block without language attribute', () => {
    const div = document.createElement('div');
    div.innerHTML = '<pre><code>console.log("no language")</code></pre>';

    const content = extractTextContent(div);

    expect(content).toContain('```');
    expect(content).toContain('console.log("no language")');
  });

  // Test ID: INT-150
  test('sanitizeFilename handles conversation titles', () => {
    // Typical conversation titles from Gemini
    expect(sanitizeFilename('Help with Python code')).toBe('Help_with_Python_code');
    expect(sanitizeFilename('What is 2+2?')).toBe('What_is_2+2_');
    // Multiple underscores are collapsed to single underscore
    expect(sanitizeFilename('Review: my/project')).toBe('Review_my_project');
  });
});

describe('Streaming Detection', () => {
  // Test ID: INT-160
  test('detects streaming state with indicator class', () => {
    document.body.innerHTML = '<div class="streaming-indicator">Generating...</div>';
    expect(isStreaming()).toBe(true);
  });

  // Test ID: INT-170
  test('detects streaming state with data attribute', () => {
    document.body.innerHTML = '<div data-streaming="true">Response...</div>';
    expect(isStreaming()).toBe(true);
  });

  // Test ID: INT-180
  test('returns false when not streaming', () => {
    document.body.innerHTML = '<button>Send</button><div>Static content</div>';
    expect(isStreaming()).toBe(false);
  });
});

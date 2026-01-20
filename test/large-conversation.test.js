/**
 * Tests for large conversation handling and batching logic.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 * Covers: Requirement 5 (100+ turns), Scenario 080
 */

const {
  extractTurns,
  extractConversation
} = require('../extension/src/content.js');

const { SELECTORS } = require('../extension/src/selectors.js');

global.SELECTORS = SELECTORS;

describe('Large Conversation Support', () => {
  // Test ID: LARGE-010 - LLD Scenario 080
  describe('extractTurns batching', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    test('handles 100+ turns without crashing', async () => {
      // Create a large conversation with 120 turns
      const container = document.createElement('main');
      container.setAttribute('data-conversation-id', 'large-test');

      for (let i = 0; i < 120; i++) {
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        turn.setAttribute('data-message-author-role', i % 2 === 0 ? 'user' : 'model');
        turn.innerHTML = `<div class="message-content">Message ${i}</div>`;
        container.appendChild(turn);
      }

      document.body.appendChild(container);

      const turns = await extractTurns();

      expect(turns.length).toBe(120);
      // Verify alternating pattern maintained
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
      expect(turns[118].role).toBe('user');
      expect(turns[119].role).toBe('assistant');
    });

    test('yields to event loop during batch processing', async () => {
      // Create 50 turns (enough to trigger batching at BATCH_SIZE=20)
      const container = document.createElement('main');
      container.setAttribute('data-conversation-id', 'batch-test');

      for (let i = 0; i < 50; i++) {
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        turn.setAttribute('data-message-author-role', i % 2 === 0 ? 'user' : 'model');
        turn.innerHTML = `<div>Turn ${i}</div>`;
        container.appendChild(turn);
      }

      document.body.appendChild(container);

      // Track if the function yields (allows other code to run)
      let yieldCount = 0;
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = (fn, ms) => {
        if (ms === 0) yieldCount++;
        return originalSetTimeout(fn, ms);
      };

      const turns = await extractTurns();

      global.setTimeout = originalSetTimeout;

      expect(turns.length).toBe(50);
      // Should yield at least once (50/20 = 2 batches, 1 yield)
      expect(yieldCount).toBeGreaterThanOrEqual(1);
    });

    test('maintains correct indices for all turns', async () => {
      const container = document.createElement('main');
      container.setAttribute('data-conversation-id', 'index-test');

      for (let i = 0; i < 30; i++) {
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        turn.setAttribute('data-message-author-role', i % 2 === 0 ? 'user' : 'model');
        turn.innerHTML = `<div>Turn ${i}</div>`;
        container.appendChild(turn);
      }

      document.body.appendChild(container);

      const turns = await extractTurns();

      // Verify all indices are sequential
      turns.forEach((turn, i) => {
        expect(turn.index).toBe(i);
      });
    });
  });

  // Test ID: LARGE-020 - Full extraction with large data
  describe('extractConversation with large data', () => {
    beforeEach(() => {
      // Use fast scroll config for tests
      const { setScrollConfig } = require('../extension/src/content.js');
      setScrollConfig({
        scrollStep: 100,
        scrollDelay: 10,
        mutationTimeout: 50,
        maxScrollAttempts: 20,
        loadingCheckInterval: 10,
        maxLoadingWait: 100,
        progressUpdateInterval: 2
      });
    });

    afterEach(() => {
      const { resetScrollConfig } = require('../extension/src/content.js');
      resetScrollConfig();
    });

    test('extracts 100+ turn conversation successfully', async () => {
      const container = document.createElement('main');
      container.setAttribute('data-conversation-id', 'full-large-test');

      const h1 = document.createElement('h1');
      h1.setAttribute('data-conversation-title', '');
      h1.textContent = 'Large Test Conversation';
      container.appendChild(h1);

      for (let i = 0; i < 100; i++) {
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        turn.setAttribute('data-message-author-role', i % 2 === 0 ? 'user' : 'model');
        turn.innerHTML = `<div class="message-content">Message number ${i} with some content here.</div>`;
        container.appendChild(turn);
      }

      document.body.innerHTML = '';
      document.body.appendChild(container);

      const result = await extractConversation();

      expect(result.success).toBe(true);
      expect(result.data.messages.length).toBe(100);
      expect(result.data.metadata.messageCount).toBe(100);
    });

    test('handles mixed content types in large conversation', async () => {
      const container = document.createElement('main');
      container.setAttribute('data-conversation-id', 'mixed-large');

      const h1 = document.createElement('h1');
      h1.setAttribute('data-conversation-title', '');
      h1.textContent = 'Mixed Content Test';
      container.appendChild(h1);

      for (let i = 0; i < 50; i++) {
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        const isUser = i % 2 === 0;
        turn.setAttribute('data-message-author-role', isUser ? 'user' : 'model');

        if (isUser) {
          // User turns: some with images
          turn.innerHTML = i % 4 === 0
            ? `<div>User message ${i} <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="></div>`
            : `<div>User message ${i}</div>`;
        } else {
          // Assistant turns: some with code, some with thinking
          if (i % 6 === 1) {
            turn.innerHTML = `
              <div class="thinking-content">Thinking about message ${i}...</div>
              <div class="response-container">Response ${i}</div>
            `;
          } else if (i % 4 === 1) {
            turn.innerHTML = `<div class="response-container">Here's code: <pre><code data-language="python">print(${i})</code></pre></div>`;
          } else {
            turn.innerHTML = `<div class="response-container">Response ${i}</div>`;
          }
        }

        container.appendChild(turn);
      }

      document.body.innerHTML = '';
      document.body.appendChild(container);

      const result = await extractConversation();

      expect(result.success).toBe(true);
      expect(result.data.messages.length).toBe(50);

      // Verify code blocks preserved
      const turnsWithCode = result.data.messages.filter(t => t.content.includes('```python'));
      expect(turnsWithCode.length).toBeGreaterThan(0);

      // Verify thinking sections captured
      const turnsWithThinking = result.data.messages.filter(t => t.thinking !== null);
      expect(turnsWithThinking.length).toBeGreaterThan(0);
    });
  });

  // Test ID: LARGE-030 - Fallback selector ordering
  describe('DOM order preservation with fallback selectors', () => {
    test('maintains correct order when using fallback selectors', async () => {
      // Use only user-query-container and model-response-container classes (no data attributes)
      const container = document.createElement('main');
      container.setAttribute('data-conversation-id', 'fallback-test');

      for (let i = 0; i < 10; i++) {
        const turn = document.createElement('div');
        turn.className = i % 2 === 0 ? 'user-query-container' : 'model-response-container';
        turn.innerHTML = `<div>Message ${i}</div>`;
        container.appendChild(turn);
      }

      document.body.innerHTML = '';
      document.body.appendChild(container);

      const turns = await extractTurns();

      expect(turns.length).toBe(10);
      // First element should be user (index 0)
      expect(turns[0].role).toBe('user');
      // Indices should be sequential
      for (let i = 0; i < 10; i++) {
        expect(turns[i].index).toBe(i);
      }
    });
  });
});

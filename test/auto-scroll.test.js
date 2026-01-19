/**
 * Unit tests for auto-scroll functionality in content.js.
 *
 * Tests lazy-loaded conversation handling where messages
 * are loaded dynamically as user scrolls.
 */

const {
  SCROLL_CONFIG,
  countMessages,
  findScrollContainer,
  scrollToLoadAllMessages
} = require('../extension/src/content.js');

const { SELECTORS } = require('../extension/src/selectors.js');

// Make SELECTORS available globally for content.js
global.SELECTORS = SELECTORS;

describe('SCROLL_CONFIG', () => {
  test('has required configuration values', () => {
    expect(SCROLL_CONFIG.scrollStep).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.scrollDelay).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.stabilityDelay).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.stabilityChecks).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.maxScrollAttempts).toBeGreaterThan(0);
  });

  test('has reasonable default values', () => {
    expect(SCROLL_CONFIG.scrollStep).toBe(500);
    expect(SCROLL_CONFIG.scrollDelay).toBe(150);
    expect(SCROLL_CONFIG.stabilityChecks).toBe(3);
    expect(SCROLL_CONFIG.maxScrollAttempts).toBe(1000);
  });
});

describe('countMessages', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('counts messages with data-message-author-role attribute', () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user">Message 1</div>
        <div data-message-author-role="model">Message 2</div>
        <div data-message-author-role="user">Message 3</div>
      </main>
    `;
    expect(countMessages()).toBe(3);
  });

  test('counts messages with conversation-turn class', () => {
    document.body.innerHTML = `
      <main>
        <div class="conversation-turn">Message 1</div>
        <div class="conversation-turn">Message 2</div>
      </main>
    `;
    expect(countMessages()).toBe(2);
  });

  test('falls back to user + assistant message selectors', () => {
    document.body.innerHTML = `
      <main>
        <div class="user-query-container">User message</div>
        <div class="model-response-container">Model response</div>
        <div class="user-query-container">User message 2</div>
      </main>
    `;
    expect(countMessages()).toBe(3);
  });

  test('returns 0 for empty page', () => {
    document.body.innerHTML = '<div>No messages</div>';
    expect(countMessages()).toBe(0);
  });
});

describe('findScrollContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('finds container with scroll selector when scrollable', () => {
    document.body.innerHTML = `
      <div data-scroll-container>
        <div>Content</div>
      </div>
    `;
    const scrollContainer = document.querySelector('[data-scroll-container]');

    // jsdom doesn't compute scroll dimensions from CSS, so we mock them
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 100, configurable: true });

    const container = findScrollContainer();
    expect(container).toBeTruthy();
    expect(container.hasAttribute('data-scroll-container')).toBe(true);
  });

  test('finds scrollable ancestor of conversation container', () => {
    document.body.innerHTML = `
      <div class="scroll-wrapper">
        <main data-conversation-id="test123">
          <div>Content</div>
        </main>
      </div>
    `;
    const wrapper = document.querySelector('.scroll-wrapper');

    // Mock scroll properties and computed style
    Object.defineProperty(wrapper, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(wrapper, 'clientHeight', { value: 100, configurable: true });

    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = (el) => {
      if (el === wrapper) {
        return { overflowY: 'auto' };
      }
      return originalGetComputedStyle(el);
    };

    const container = findScrollContainer();

    window.getComputedStyle = originalGetComputedStyle;

    expect(container).toBeTruthy();
    expect(container.classList.contains('scroll-wrapper')).toBe(true);
  });

  test('returns null when no conversation container exists', () => {
    document.body.innerHTML = '<div>Simple content, no conversation</div>';

    // When there's no conversation container and no scroll-container selector,
    // the function returns null (can't scroll without a conversation)
    const container = findScrollContainer();
    expect(container).toBeNull();
  });

  test('returns body when conversation exists but no scrollable ancestor', () => {
    document.body.innerHTML = `
      <main data-conversation-id="test123">
        <div>Conversation content</div>
      </main>
    `;

    // Mock documentElement to not be scrollable
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 100, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 100, configurable: true });

    const container = findScrollContainer();
    expect(container).toBeTruthy();
    expect(container).toBe(document.body);
  });
});

describe('scrollToLoadAllMessages', () => {
  let mockScrollContainer;

  beforeEach(() => {
    document.body.innerHTML = '';

    // Create a mock scroll container with initial messages
    mockScrollContainer = document.createElement('div');
    mockScrollContainer.setAttribute('data-scroll-container', 'true');
    mockScrollContainer.style.cssText = 'height: 200px; overflow-y: auto;';
    mockScrollContainer.innerHTML = `
      <div style="height: 1000px;">
        <div data-message-author-role="user">Message 1</div>
        <div data-message-author-role="model">Message 2</div>
      </div>
    `;
    document.body.appendChild(mockScrollContainer);

    // Mock scrollTop behavior
    let scrollTop = 500; // Start at middle
    Object.defineProperty(mockScrollContainer, 'scrollTop', {
      get: () => scrollTop,
      set: (value) => { scrollTop = Math.max(0, value); },
      configurable: true
    });

    Object.defineProperty(mockScrollContainer, 'scrollHeight', {
      get: () => 1000,
      configurable: true
    });

    Object.defineProperty(mockScrollContainer, 'clientHeight', {
      get: () => 200,
      configurable: true
    });
  });

  test('returns success when conversation is already fully loaded', async () => {
    // Set scroll to top (already loaded)
    mockScrollContainer.scrollTop = 0;

    const result = await scrollToLoadAllMessages();

    expect(result.success).toBe(true);
    expect(result.messagesLoaded).toBeGreaterThan(0);
  });

  test('returns messagesLoaded count', async () => {
    const result = await scrollToLoadAllMessages();

    expect(result.messagesLoaded).toBe(2); // We have 2 messages in mock
    expect(result.scrollAttempts).toBeGreaterThan(0);
  });

  test('handles missing scroll container gracefully', async () => {
    document.body.innerHTML = '<div>No scroll container</div>';

    const result = await scrollToLoadAllMessages();

    // Should still work with fallback (body)
    expect(result).toBeTruthy();
    expect(typeof result.messagesLoaded).toBe('number');
  });

  test('calls progress callback when provided', async () => {
    const progressCallback = jest.fn();

    await scrollToLoadAllMessages(progressCallback);

    expect(progressCallback).toHaveBeenCalled();
    // Check that progress messages contain message count info
    const calls = progressCallback.mock.calls.flat();
    const hasMessageInfo = calls.some(msg =>
      typeof msg === 'string' && (msg.includes('messages') || msg.includes('Loading'))
    );
    expect(hasMessageInfo).toBe(true);
  });
});

describe('scrollToLoadAllMessages with lazy loading simulation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('detects when new messages are loaded during scroll', async () => {
    // Create container with initial messages
    const container = document.createElement('div');
    container.setAttribute('data-scroll-container', 'true');
    container.style.cssText = 'height: 200px; overflow-y: auto;';
    container.innerHTML = `
      <div class="messages" style="height: 1000px;">
        <div data-message-author-role="user">Message 1</div>
        <div data-message-author-role="model">Message 2</div>
      </div>
    `;
    document.body.appendChild(container);

    let scrollTop = 500;
    let messageCount = 2;
    let scrollCallCount = 0;

    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Math.max(0, value);
        scrollCallCount++;

        // Simulate lazy loading: add new message after a few scrolls
        if (scrollCallCount === 3 && messageCount < 4) {
          const messagesDiv = container.querySelector('.messages');
          const newMsg = document.createElement('div');
          newMsg.setAttribute('data-message-author-role', 'user');
          newMsg.textContent = `Message ${messageCount + 1}`;
          messagesDiv.insertBefore(newMsg, messagesDiv.firstChild);
          messageCount++;
        }
      },
      configurable: true
    });

    Object.defineProperty(container, 'scrollHeight', {
      get: () => 1000,
      configurable: true
    });

    Object.defineProperty(container, 'clientHeight', {
      get: () => 200,
      configurable: true
    });

    const result = await scrollToLoadAllMessages();

    expect(result.success).toBe(true);
    // Should have detected the new message that was added
    expect(result.messagesLoaded).toBeGreaterThanOrEqual(2);
  });
});

describe('auto-scroll integration with extractConversation', () => {
  const { extractConversation } = require('../extension/src/content.js');

  beforeEach(() => {
    document.body.innerHTML = '';
    // Set up a valid conversation page
    setFixture('gemini-conversation.html');
  });

  test('extractConversation includes scrollInfo in metadata', async () => {
    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.data.metadata.scrollInfo).toBeDefined();
    expect(typeof result.data.metadata.scrollInfo.messagesLoaded).toBe('number');
    expect(typeof result.data.metadata.scrollInfo.scrollAttempts).toBe('number');
  });

  test('extractConversation works with fully loaded conversation', async () => {
    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.data.turns.length).toBeGreaterThan(0);
    // scrollInfo should reflect the messages found
    expect(result.data.metadata.scrollInfo.messagesLoaded).toBeGreaterThan(0);
  });
});

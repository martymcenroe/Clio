/**
 * Unit tests for auto-scroll functionality in content.js (v2.0).
 *
 * Tests MutationObserver-based lazy-loaded conversation handling
 * where messages are loaded dynamically as user scrolls.
 *
 * LLD Reference: docs/lld-auto-scroll.md
 */

const {
  SCROLL_CONFIG,
  setScrollConfig,
  resetScrollConfig,
  countMessages,
  findScrollContainer,
  waitForLoadingComplete,
  scrollToLoadAllMessages
} = require('../extension/src/content.js');

const { SELECTORS } = require('../extension/src/selectors.js');

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

describe('SCROLL_CONFIG (v2.0)', () => {
  // Test ID: SCROLL-CONFIG-001
  test('has required configuration values', () => {
    expect(SCROLL_CONFIG.scrollStep).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.scrollDelay).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.mutationTimeout).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.maxScrollAttempts).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.loadingCheckInterval).toBeGreaterThan(0);
    expect(SCROLL_CONFIG.maxLoadingWait).toBeGreaterThan(0);
  });

  // Test ID: SCROLL-CONFIG-002
  test('has revised values for network latency', () => {
    // v2.2: 1.5s delay to wait for Gemini content loading
    expect(SCROLL_CONFIG.scrollStep).toBe(800);
    expect(SCROLL_CONFIG.scrollDelay).toBe(1500);     // 1.5s per scroll for Gemini latency
    expect(SCROLL_CONFIG.mutationTimeout).toBe(3000); // Increased from 2000 for slow responses
    expect(SCROLL_CONFIG.maxScrollAttempts).toBe(500);
  });

  // Test ID: SCROLL-CONFIG-003
  test('has loading indicator configuration', () => {
    expect(SCROLL_CONFIG.loadingCheckInterval).toBe(100);
    expect(SCROLL_CONFIG.maxLoadingWait).toBe(15000); // Increased from 10000 for slow responses
  });
});

describe('countMessages', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // Test ID: SCROLL-COUNT-001
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

  // Test ID: SCROLL-COUNT-002
  test('counts messages with conversation-turn class', () => {
    document.body.innerHTML = `
      <main>
        <div class="conversation-turn">Message 1</div>
        <div class="conversation-turn">Message 2</div>
      </main>
    `;
    expect(countMessages()).toBe(2);
  });

  // Test ID: SCROLL-COUNT-003
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

  // Test ID: SCROLL-COUNT-004
  test('returns 0 for empty page', () => {
    document.body.innerHTML = '<div>No messages</div>';
    expect(countMessages()).toBe(0);
  });
});

describe('findScrollContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // Test ID: SCROLL-FIND-001
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

  // Test ID: SCROLL-FIND-002
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

  // Test ID: SCROLL-FIND-003
  test('returns null when no conversation container exists', () => {
    document.body.innerHTML = '<div>Simple content, no conversation</div>';

    // When there's no conversation container and no scroll-container selector,
    // the function returns null (can't scroll without a conversation)
    const container = findScrollContainer();
    expect(container).toBeNull();
  });

  // Test ID: SCROLL-FIND-004
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

describe('waitForLoadingComplete', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Test ID: SCROLL-LOAD-001
  test('returns immediately when no loading indicator exists', async () => {
    document.body.innerHTML = '<div>No loading</div>';

    const promise = waitForLoadingComplete();
    jest.advanceTimersByTime(10);
    await promise;

    // Should complete without waiting
    expect(true).toBe(true);
  });

  // Test ID: SCROLL-LOAD-002
  test('waits for loading indicator to disappear', async () => {
    document.body.innerHTML = '<div class="loading-spinner">Loading...</div>';
    const spinner = document.querySelector('.loading-spinner');

    // Make spinner visible
    Object.defineProperty(spinner, 'offsetParent', { value: document.body, configurable: true });

    let completed = false;
    const promise = waitForLoadingComplete().then(() => { completed = true; });

    // Advance some time - should still be waiting
    jest.advanceTimersByTime(200);
    expect(completed).toBe(false);

    // Hide the spinner
    Object.defineProperty(spinner, 'offsetParent', { value: null, configurable: true });

    // Advance time for next check
    jest.advanceTimersByTime(SCROLL_CONFIG.loadingCheckInterval);
    await promise;

    expect(completed).toBe(true);
  });
});

describe('scrollToLoadAllMessages (v2.0 MutationObserver)', () => {
  let mockScrollContainer;

  beforeEach(() => {
    document.body.innerHTML = '';
    // Use fast config for tests
    setScrollConfig(FAST_SCROLL_CONFIG);

    // Create a mock scroll container with initial messages
    mockScrollContainer = document.createElement('div');
    mockScrollContainer.setAttribute('data-scroll-container', 'true');
    mockScrollContainer.style.cssText = 'height: 200px; overflow-y: auto;';
    mockScrollContainer.innerHTML = `
      <div class="messages" style="height: 1000px;">
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

  // Test ID: SCROLL-001
  test('returns success when conversation is already fully loaded', async () => {
    // Set scroll to top (already loaded)
    mockScrollContainer.scrollTop = 0;

    const result = await scrollToLoadAllMessages();

    expect(result.success).toBe(true);
    expect(result.messagesLoaded).toBeGreaterThan(0);
  });

  // Test ID: SCROLL-002
  test('dispatches scroll events during scrolling', async () => {
    const scrollEventFired = jest.fn();
    mockScrollContainer.addEventListener('scroll', scrollEventFired);

    await scrollToLoadAllMessages();

    // Should have dispatched scroll events
    expect(scrollEventFired).toHaveBeenCalled();
  });

  // Test ID: SCROLL-003
  test('returns messagesLoaded count', async () => {
    const result = await scrollToLoadAllMessages();

    expect(result.messagesLoaded).toBe(2); // We have 2 messages in mock
    expect(result.scrollAttempts).toBeGreaterThan(0);
  });

  // Test ID: SCROLL-005
  test('handles missing scroll container gracefully', async () => {
    document.body.innerHTML = '<div>No scroll container</div>';

    const result = await scrollToLoadAllMessages();

    // Should still work with fallback (body)
    expect(result).toBeTruthy();
    expect(typeof result.messagesLoaded).toBe('number');
  });

  // Test ID: SCROLL-006
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

describe('scrollToLoadAllMessages MutationObserver detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Use fast config for tests
    setScrollConfig(FAST_SCROLL_CONFIG);
  });

  afterEach(() => {
    resetScrollConfig();
  });

  // Test ID: SCROLL-MUT-001
  test('detects DOM mutations during scroll', async () => {
    // Create container with initial messages
    const container = document.createElement('div');
    container.setAttribute('data-scroll-container', 'true');
    container.innerHTML = `
      <div class="messages">
        <div data-message-author-role="user">Message 1</div>
        <div data-message-author-role="model">Message 2</div>
      </div>
    `;
    document.body.appendChild(container);

    let scrollTop = 500;
    let scrollCallCount = 0;

    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Math.max(0, value);
        scrollCallCount++;

        // Simulate lazy loading: add new message after scroll
        if (scrollCallCount === 2) {
          const messagesDiv = container.querySelector('.messages');
          const newMsg = document.createElement('div');
          newMsg.setAttribute('data-message-author-role', 'user');
          newMsg.textContent = 'Message 3';
          messagesDiv.insertBefore(newMsg, messagesDiv.firstChild);
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
    // Should have detected the mutation and continued scrolling
    expect(result.scrollAttempts).toBeGreaterThan(1);
  });

  // Test ID: SCROLL-MUT-002
  test('handles virtualized lists where count stays constant', async () => {
    // Simulate virtualized list: elements are added AND removed
    const container = document.createElement('div');
    container.setAttribute('data-scroll-container', 'true');
    container.innerHTML = `
      <div class="messages">
        <div data-message-author-role="user">Message 1</div>
        <div data-message-author-role="model">Message 2</div>
      </div>
    `;
    document.body.appendChild(container);

    let scrollTop = 500;
    let scrollCallCount = 0;

    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Math.max(0, value);
        scrollCallCount++;

        // Simulate virtualized scrolling: add one, remove one (count stays same)
        if (scrollCallCount >= 2 && scrollCallCount <= 4) {
          const messagesDiv = container.querySelector('.messages');
          // Add new message at top
          const newMsg = document.createElement('div');
          newMsg.setAttribute('data-message-author-role', 'user');
          newMsg.textContent = `New Message ${scrollCallCount}`;
          messagesDiv.insertBefore(newMsg, messagesDiv.firstChild);
          // Remove message at bottom (simulating virtualization)
          if (messagesDiv.lastChild) {
            messagesDiv.removeChild(messagesDiv.lastChild);
          }
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
    // MutationObserver should detect changes even though count stayed same
    expect(result.scrollAttempts).toBeGreaterThan(2);
  });
});

describe('auto-scroll integration with extractConversation', () => {
  const { extractConversation } = require('../extension/src/content.js');

  beforeEach(() => {
    document.body.innerHTML = '';
    // Use fast config for tests
    setScrollConfig(FAST_SCROLL_CONFIG);
    // Set up a valid conversation page
    setFixture('gemini-conversation.html');
  });

  afterEach(() => {
    resetScrollConfig();
  });

  // Test ID: SCROLL-INT-001
  test('extractConversation includes scrollInfo in metadata', async () => {
    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.data.metadata.scrollInfo).toBeDefined();
    expect(typeof result.data.metadata.scrollInfo.messagesLoaded).toBe('number');
    expect(typeof result.data.metadata.scrollInfo.scrollAttempts).toBe('number');
  });

  // Test ID: SCROLL-INT-002
  test('extractConversation works with fully loaded conversation', async () => {
    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.data.messages.length).toBeGreaterThan(0);
    // scrollInfo should reflect the messages found
    expect(result.data.metadata.scrollInfo.messagesLoaded).toBeGreaterThan(0);
  });
});

describe('SELECTORS.loadingIndicator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // Test ID: SCROLL-SEL-001
  test('loadingIndicator selector exists', () => {
    expect(SELECTORS.loadingIndicator).toBeDefined();
    expect(typeof SELECTORS.loadingIndicator).toBe('string');
  });

  // Test ID: SCROLL-SEL-002
  test('loadingIndicator matches common loading patterns', () => {
    // Test various loading indicator patterns
    // VERIFIED patterns from real Gemini DOM
    const patterns = [
      '<mat-progress-spinner class="mdc-circular-progress"></mat-progress-spinner>',
      '<div class="mdc-circular-progress">Loading</div>',
      '<div role="progressbar" aria-label="Loading"></div>',
      '<div aria-busy="true">Loading</div>',
      '<div class="loading-spinner"></div>'
    ];

    for (const pattern of patterns) {
      document.body.innerHTML = pattern;
      const el = document.querySelector(SELECTORS.loadingIndicator);
      expect(el).toBeTruthy();
    }
  });
});

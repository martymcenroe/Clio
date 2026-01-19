/**
 * Tests for Chrome extension message passing.
 *
 * LLD Reference: docs/reports/1/lld-clio.md
 * Covers: Content script <-> Popup communication
 */

const { SELECTORS } = require('../extension/src/selectors.js');

global.SELECTORS = SELECTORS;

describe('Chrome Message Passing', () => {
  let messageHandler = null;
  let originalAddListener;

  beforeEach(() => {
    // Capture the message handler when content.js is loaded
    originalAddListener = chrome.runtime.onMessage.addListener;
    chrome.runtime.onMessage.addListener = jest.fn((handler) => {
      messageHandler = handler;
    });

    // Clear module cache to reload content.js with fresh handler
    jest.resetModules();

    // Set up valid DOM
    setFixture('gemini-conversation.html');
  });

  afterEach(() => {
    chrome.runtime.onMessage.addListener = originalAddListener;
    messageHandler = null;
  });

  test('registers message listener on load', () => {
    // Re-require content.js to trigger listener registration
    require('../extension/src/content.js');

    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(messageHandler).not.toBeNull();
  });

  test('responds to extract action', (done) => {
    require('../extension/src/content.js');

    expect(messageHandler).not.toBeNull();

    const sendResponse = jest.fn((response) => {
      expect(response).toBeDefined();
      expect(response.success).toBeDefined();
      done();
    });

    // Call the handler - it should return true for async response
    const result = messageHandler({ action: 'extract' }, {}, sendResponse);

    expect(result).toBe(true); // Indicates async response
  });

  test('ignores non-extract actions', () => {
    require('../extension/src/content.js');

    const sendResponse = jest.fn();

    // Unknown action should not trigger response
    const result = messageHandler({ action: 'unknown' }, {}, sendResponse);

    // Should not return true (no async response)
    expect(result).not.toBe(true);
  });

  test('converts image blobs to base64 in response', (done) => {
    require('../extension/src/content.js');

    const sendResponse = jest.fn((response) => {
      if (response.success && response.images) {
        // Images should have dataUrl instead of blob (blob can't be sent via message)
        response.images.forEach(img => {
          if (img.dataUrl) {
            expect(img.blob).toBeUndefined();
            expect(img.dataUrl).toMatch(/^data:/);
          }
        });
      }
      done();
    });

    messageHandler({ action: 'extract' }, {}, sendResponse);
  });

  test('returns error response when extraction fails', (done) => {
    // Set up invalid DOM to trigger failure
    document.body.innerHTML = '<div>No conversation here</div>';

    require('../extension/src/content.js');

    const sendResponse = jest.fn((response) => {
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      done();
    });

    messageHandler({ action: 'extract' }, {}, sendResponse);
  });
});

describe('Message Response Format', () => {
  beforeEach(() => {
    jest.resetModules();
    setFixture('gemini-conversation.html');
  });

  test('successful response has required fields', (done) => {
    let handler;
    chrome.runtime.onMessage.addListener = jest.fn((h) => { handler = h; });

    require('../extension/src/content.js');

    const sendResponse = (response) => {
      expect(response).toHaveProperty('success');
      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('images');
      expect(response).toHaveProperty('warnings');

      if (response.success) {
        expect(response.data).toHaveProperty('metadata');
        expect(response.data).toHaveProperty('turns');
      }
      done();
    };

    handler({ action: 'extract' }, {}, sendResponse);
  });

  test('error response has required fields', (done) => {
    document.body.innerHTML = ''; // Empty DOM triggers validation failure

    let handler;
    chrome.runtime.onMessage.addListener = jest.fn((h) => { handler = h; });

    require('../extension/src/content.js');

    const sendResponse = (response) => {
      expect(response).toHaveProperty('success', false);
      expect(response).toHaveProperty('error');
      expect(typeof response.error).toBe('string');
      done();
    };

    handler({ action: 'extract' }, {}, sendResponse);
  });
});

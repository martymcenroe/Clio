/**
 * Unit tests for popup.js
 *
 * Tests UI helper functions, filename sanitization, size estimation,
 * zip creation, and download functionality.
 */

const {
  isSupportedSite,
  getSitePrefix,
  sanitizeFilename,
  estimateExportSize,
  formatBytes,
  setStatus,
  showProgress,
  hideProgress,
  showResult,
  setButtonState,
  saveLastResult,
  restoreLastResult,
  sendExtractMessage,
  scriptsForSite,
  createZip,
  downloadBlob,
  handleExtract
} = require('../extensions/src/popup.js');

// Set up DOM before each test
beforeEach(() => {
  setFixture('popup.html');
});

// ============================================================================
// Pure Functions
// ============================================================================

describe('isSupportedSite', () => {
  test('returns true for Gemini URL', () => {
    expect(isSupportedSite('https://gemini.google.com/app/abc123')).toBe(true);
  });

  test('returns true for Claude URL', () => {
    expect(isSupportedSite('https://claude.ai/chat/b5b2d739-81b0-4ee7-aa1a-3209c66c25d0')).toBe(true);
  });

  test('returns true for ChatGPT URL', () => {
    expect(isSupportedSite('https://chatgpt.com/c/67bd8097-de20-8013-82de-4fb74629b1b3')).toBe(true);
  });

  test('returns false for unrelated URL', () => {
    expect(isSupportedSite('https://google.com')).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(isSupportedSite(null)).toBe(false);
    expect(isSupportedSite(undefined)).toBe(false);
    expect(isSupportedSite('')).toBe(false);
  });
});

describe('getSitePrefix', () => {
  test('returns gemini for Gemini URL', () => {
    expect(getSitePrefix('https://gemini.google.com/app/abc123')).toBe('gemini');
  });

  test('returns claude for Claude URL', () => {
    expect(getSitePrefix('https://claude.ai/chat/abc')).toBe('claude');
  });

  test('returns chatgpt for ChatGPT URL', () => {
    expect(getSitePrefix('https://chatgpt.com/c/abc')).toBe('chatgpt');
  });

  test('defaults to gemini for unknown URL', () => {
    expect(getSitePrefix('https://example.com')).toBe('gemini');
  });
});

describe('sanitizeFilename', () => {
  test('removes illegal filesystem characters', () => {
    expect(sanitizeFilename('test/file:name*.txt')).toBe('test_file_name_.txt');
  });

  test('replaces forward slash with underscore', () => {
    expect(sanitizeFilename('path/to/file')).toBe('path_to_file');
  });

  test('replaces backslash with underscore', () => {
    expect(sanitizeFilename('path\\to\\file')).toBe('path_to_file');
  });

  test('replaces colon with underscore', () => {
    expect(sanitizeFilename('file:name')).toBe('file_name');
  });

  test('replaces asterisk with underscore', () => {
    expect(sanitizeFilename('file*name')).toBe('file_name');
  });

  test('replaces question mark with underscore', () => {
    expect(sanitizeFilename('file?name')).toBe('file_name');
  });

  test('replaces quotes with underscore', () => {
    expect(sanitizeFilename('file"name')).toBe('file_name');
  });

  test('replaces angle brackets with underscore', () => {
    expect(sanitizeFilename('file<>name')).toBe('file_name');
  });

  test('replaces pipe with underscore', () => {
    expect(sanitizeFilename('file|name')).toBe('file_name');
  });

  test('replaces spaces with underscores', () => {
    expect(sanitizeFilename('my file name.txt')).toBe('my_file_name.txt');
  });

  test('replaces multiple spaces with single underscore', () => {
    expect(sanitizeFilename('file   name')).toBe('file_name');
  });

  test('collapses multiple underscores', () => {
    expect(sanitizeFilename('test___file')).toBe('test_file');
  });

  test('handles empty input', () => {
    expect(sanitizeFilename('')).toBe('untitled');
  });

  test('handles null input', () => {
    expect(sanitizeFilename(null)).toBe('untitled');
  });

  test('handles undefined input', () => {
    expect(sanitizeFilename(undefined)).toBe('untitled');
  });

  test('truncates long filenames to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(sanitizeFilename(longName).length).toBe(100);
  });

  test('preserves valid filename characters', () => {
    expect(sanitizeFilename('valid-file_name.txt')).toBe('valid-file_name.txt');
  });

  test('handles all dangerous characters together', () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe('file_name');
  });
});

describe('estimateExportSize', () => {
  test('returns 0 for empty array', () => {
    expect(estimateExportSize([])).toBe(0);
  });

  test('returns 0 for images without dataUrl', () => {
    const images = [
      { filename: 'img1.png' },
      { filename: 'img2.png' }
    ];
    expect(estimateExportSize(images)).toBe(0);
  });

  test('estimates size for single image', () => {
    // Create a mock base64 data URL (after comma is 100 chars)
    const base64 = 'a'.repeat(100);
    const images = [
      { dataUrl: `data:image/png;base64,${base64}`, filename: 'img1.png' }
    ];
    // 100 chars * 0.75 = 75 bytes (base64 to binary conversion)
    expect(estimateExportSize(images)).toBe(75);
  });

  test('estimates size for multiple images', () => {
    const base64_1 = 'a'.repeat(100);
    const base64_2 = 'b'.repeat(200);
    const images = [
      { dataUrl: `data:image/png;base64,${base64_1}`, filename: 'img1.png' },
      { dataUrl: `data:image/jpeg;base64,${base64_2}`, filename: 'img2.jpg' }
    ];
    // (100 * 0.75) + (200 * 0.75) = 75 + 150 = 225
    expect(estimateExportSize(images)).toBe(225);
  });

  test('handles mixed images with and without dataUrl', () => {
    const base64 = 'a'.repeat(100);
    const images = [
      { dataUrl: `data:image/png;base64,${base64}`, filename: 'img1.png' },
      { filename: 'img2.png' } // no dataUrl
    ];
    expect(estimateExportSize(images)).toBe(75);
  });
});

describe('formatBytes', () => {
  test('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  test('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  test('formats megabytes', () => {
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });

  test('formats exactly 1KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  test('formats exactly 1MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  test('handles zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  test('handles boundary between bytes and KB', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  test('handles boundary between KB and MB', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});

// ============================================================================
// DOM Helper Functions
// ============================================================================

describe('setStatus', () => {
  test('sets status text content', () => {
    setStatus('Test message');
    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Test message');
  });

  test('sets info class by default', () => {
    setStatus('Test message');
    const statusEl = document.getElementById('status');
    expect(statusEl.className).toBe('status info');
  });

  test('sets error class', () => {
    setStatus('Error message', 'error');
    const statusEl = document.getElementById('status');
    expect(statusEl.className).toBe('status error');
  });

  test('sets warning class', () => {
    setStatus('Warning message', 'warning');
    const statusEl = document.getElementById('status');
    expect(statusEl.className).toBe('status warning');
  });

  test('sets ready class', () => {
    setStatus('Ready message', 'ready');
    const statusEl = document.getElementById('status');
    expect(statusEl.className).toBe('status ready');
  });
});

describe('showProgress', () => {
  test('adds visible class to progress element', () => {
    const progressEl = document.getElementById('progress');
    expect(progressEl.classList.contains('visible')).toBe(false);

    showProgress('Loading...');
    expect(progressEl.classList.contains('visible')).toBe(true);
  });

  test('sets progress text', () => {
    showProgress('Extracting data...');
    const progressText = document.getElementById('progressText');
    expect(progressText.textContent).toBe('Extracting data...');
  });
});

describe('hideProgress', () => {
  test('removes visible class from progress element', () => {
    const progressEl = document.getElementById('progress');
    progressEl.classList.add('visible');

    hideProgress();
    expect(progressEl.classList.contains('visible')).toBe(false);
  });
});

describe('showResult', () => {
  test('adds visible class to result element', () => {
    const resultEl = document.getElementById('result');
    expect(resultEl.classList.contains('visible')).toBe(false);

    showResult(10, 5, 2);
    expect(resultEl.classList.contains('visible')).toBe(true);
  });

  test('sets message count', () => {
    showResult(10, 5, 2);
    const messageCountEl = document.getElementById('messageCount');
    expect(messageCountEl.textContent).toBe('10');
  });

  test('sets image count', () => {
    showResult(10, 5, 2);
    const imageCountEl = document.getElementById('imageCount');
    expect(imageCountEl.textContent).toBe('5');
  });

  test('sets error count', () => {
    showResult(10, 5, 2);
    const errorCountEl = document.getElementById('errorCount');
    expect(errorCountEl.textContent).toBe('2');
  });

  test('handles zero values', () => {
    showResult(0, 0, 0);
    expect(document.getElementById('messageCount').textContent).toBe('0');
    expect(document.getElementById('imageCount').textContent).toBe('0');
    expect(document.getElementById('errorCount').textContent).toBe('0');
  });
});

describe('setButtonState', () => {
  test('enables button when true', () => {
    const extractBtn = document.getElementById('extractBtn');
    extractBtn.disabled = true;

    setButtonState(true);
    expect(extractBtn.disabled).toBe(false);
  });

  test('disables button when false', () => {
    const extractBtn = document.getElementById('extractBtn');
    extractBtn.disabled = false;

    setButtonState(false);
    expect(extractBtn.disabled).toBe(true);
  });

  test('sets default button text', () => {
    setButtonState(true);
    const extractBtn = document.getElementById('extractBtn');
    expect(extractBtn.textContent).toBe('Extract Conversation');
  });

  test('sets custom button text', () => {
    setButtonState(false, 'Processing...');
    const extractBtn = document.getElementById('extractBtn');
    expect(extractBtn.textContent).toBe('Processing...');
  });
});

// ============================================================================
// Last-result persistence (site-aware — #138)
// ============================================================================

describe('saveLastResult', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('persists site in the blob', () => {
    const data = {
      metadata: {
        title: 'Some Claude Conversation',
        messageCount: 10,
        imageCount: 0,
        extractionErrors: [],
        scrollInfo: { messagesLoaded: 10, scrollAttempts: 2 }
      }
    };
    saveLastResult(data, 'claude');
    const saved = JSON.parse(localStorage.getItem('clio_lastResult'));
    expect(saved.site).toBe('claude');
    expect(saved.title).toBe('Some Claude Conversation');
    expect(saved.messageCount).toBe(10);
  });

  test('stores site=null when caller omits site', () => {
    const data = {
      metadata: {
        title: 'No site',
        messageCount: 1,
        imageCount: 0,
        extractionErrors: [],
        scrollInfo: null
      }
    };
    saveLastResult(data);
    const saved = JSON.parse(localStorage.getItem('clio_lastResult'));
    expect(saved.site).toBeNull();
  });
});

describe('restoreLastResult (site-aware)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function seedCache(overrides) {
    const blob = Object.assign({
      messageCount: 10,
      imageCount: 0,
      errorCount: 0,
      scrollInfo: null,
      title: 'Cached Conversation',
      site: 'claude',
      timestamp: new Date().toISOString()
    }, overrides);
    localStorage.setItem('clio_lastResult', JSON.stringify(blob));
  }

  test('shows cached stats when currentSite matches', () => {
    seedCache({ site: 'claude' });
    const result = restoreLastResult('claude');
    expect(result).toBe(true);
  });

  test('hides cached stats when currentSite differs', () => {
    seedCache({ site: 'gemini', title: 'A Gemini chat' });
    const result = restoreLastResult('chatgpt');
    expect(result).toBe(false);
  });

  test('hides legacy cache (no site field) when currentSite is provided', () => {
    seedCache({ site: undefined });
    // Remove the explicit undefined property so it serializes without site
    const blob = JSON.parse(localStorage.getItem('clio_lastResult'));
    delete blob.site;
    localStorage.setItem('clio_lastResult', JSON.stringify(blob));
    const result = restoreLastResult('claude');
    expect(result).toBe(false);
  });

  test('hides when cache is older than 1 hour even if site matches', () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    seedCache({ site: 'claude', timestamp: stale });
    const result = restoreLastResult('claude');
    expect(result).toBe(false);
  });

  test('returns false when no cache exists', () => {
    expect(restoreLastResult('claude')).toBe(false);
  });

  test('legacy: shows cached stats when currentSite is omitted', () => {
    // Backward compat for callers that pre-date #138 — pass no
    // currentSite, get the old non-site-aware behavior.
    seedCache({ site: 'gemini' });
    const result = restoreLastResult();
    expect(result).toBe(true);
  });
});

// ============================================================================
// Content-script messaging recovery (#139)
// ============================================================================

describe('scriptsForSite', () => {
  test('claude site → claude selectors', () => {
    expect(scriptsForSite('claude')).toEqual(['src/selectors-claude.js', 'src/content.js']);
  });
  test('chatgpt site → chatgpt selectors', () => {
    expect(scriptsForSite('chatgpt')).toEqual(['src/selectors-chatgpt.js', 'src/content.js']);
  });
  test('gemini (or unknown) → default selectors', () => {
    expect(scriptsForSite('gemini')).toEqual(['src/selectors.js', 'src/content.js']);
    expect(scriptsForSite('unknown')).toEqual(['src/selectors.js', 'src/content.js']);
  });
});

describe('sendExtractMessage (re-inject + retry)', () => {
  const tab = { id: 42, url: 'https://claude.ai/chat/abc' };

  test('happy path: first sendMessage succeeds, no re-inject', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({ success: true, data: { hello: 'world' } });
    });
    const result = await sendExtractMessage(tab);
    expect(result.success).toBe(true);
    expect(result.data.hello).toBe('world');
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test('unrelated error: throws original error, no re-inject', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = { message: 'Some other unrelated error' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    await expect(sendExtractMessage(tab)).rejects.toThrow('Some other unrelated error');
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test('receiving-end error → executeScript succeeds → retry succeeds', async () => {
    let attempt = 0;
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      attempt++;
      if (attempt === 1) {
        chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        cb(null);
        chrome.runtime.lastError = null;
      } else {
        cb({ success: true, data: { recovered: true } });
      }
    });
    chrome.scripting.executeScript.mockResolvedValue([]);

    const result = await sendExtractMessage(tab);
    expect(result.success).toBe(true);
    expect(result.data.recovered).toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['src/selectors-claude.js', 'src/content.js']
    });
    expect(attempt).toBe(2);
  });

  test('receiving-end error → executeScript fails → throws friendly error', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = { message: 'Receiving end does not exist' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    chrome.scripting.executeScript.mockRejectedValue(new Error('permission denied'));
    await expect(sendExtractMessage(tab)).rejects.toThrow("Couldn't reach the page. Please reload the tab and try again.");
  });

  test('receiving-end error → executeScript ok → retry fails → throws friendly error', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = { message: 'Receiving end does not exist' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    chrome.scripting.executeScript.mockResolvedValue([]);
    await expect(sendExtractMessage(tab)).rejects.toThrow("Couldn't reach the page. Please reload the tab and try again.");
  });

  test('receiving-end error + chrome.scripting absent → friendly error', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      chrome.runtime.lastError = { message: 'Receiving end does not exist' };
      cb(null);
      chrome.runtime.lastError = null;
    });
    const savedScripting = chrome.scripting;
    delete chrome.scripting;
    try {
      await expect(sendExtractMessage(tab)).rejects.toThrow("Couldn't reach the page. Please reload the tab and try again.");
    } finally {
      chrome.scripting = savedScripting;
    }
  });
});

// ============================================================================
// Zip Creation
// ============================================================================

describe('createZip', () => {
  test('creates zip with conversation.json', async () => {
    const data = {
      metadata: { title: 'Test Conversation' },
      messages: []
    };
    const images = [];

    const blob = await createZip(data, images);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');
  });

  test('creates zip with images', async () => {
    const data = {
      metadata: { title: 'Test Conversation' },
      messages: []
    };
    const images = [
      { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', filename: 'images/img1.png' },
      { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', filename: 'images/img2.jpg' }
    ];

    const blob = await createZip(data, images);
    expect(blob).toBeInstanceOf(Blob);
  });

  test('handles images without dataUrl', async () => {
    const data = {
      metadata: { title: 'Test' },
      messages: []
    };
    const images = [
      { filename: 'images/img1.png' } // no dataUrl
    ];

    // Should not throw
    const blob = await createZip(data, images);
    expect(blob).toBeInstanceOf(Blob);
  });

  test('handles empty images array', async () => {
    const data = {
      metadata: { title: 'Test' },
      messages: []
    };

    const blob = await createZip(data, []);
    expect(blob).toBeInstanceOf(Blob);
  });
});

// ============================================================================
// Download
// ============================================================================

describe('downloadBlob', () => {
  test('calls chrome.downloads.download with correct parameters', () => {
    const blob = new Blob(['test'], { type: 'application/zip' });
    const filename = 'test.zip';

    downloadBlob(blob, filename);

    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'blob:mock-url',
        filename: 'test.zip',
        saveAs: true
      }),
      expect.any(Function)
    );
  });

  test('creates object URL for blob', () => {
    const blob = new Blob(['test'], { type: 'application/zip' });

    downloadBlob(blob, 'test.zip');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });
});

// ============================================================================
// Integration: handleExtract
// ============================================================================

describe('handleExtract', () => {
  beforeEach(() => {
    // Reset DOM state
    setFixture('popup.html');
  });

  test('shows error when not on Gemini page', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://google.com' }]);

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Please open a Gemini, Claude, or ChatGPT conversation first.');
    expect(statusEl.className).toBe('status error');
  });

  test('shows error when no tab found', async () => {
    chrome.tabs.query.mockResolvedValue([null]);

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Please open a Gemini, Claude, or ChatGPT conversation first.');
  });

  test('shows error when tab has no URL', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1 }]); // no url property

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Please open a Gemini, Claude, or ChatGPT conversation first.');
  });

  test('disables button during extraction', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc123' }]);
    // Create a promise that never resolves to test button state during extraction
    chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));

    const extractPromise = handleExtract();

    // Check button state immediately after starting
    await Promise.resolve(); // Let the async function start
    const extractBtn = document.getElementById('extractBtn');
    expect(extractBtn.disabled).toBe(true);
    expect(extractBtn.textContent).toBe('Extracting...');
  });

  test('handles extraction failure', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc123' }]);
    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      callback({ success: false, error: 'No conversation found' });
    });

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('No conversation found');
    expect(statusEl.className).toBe('status error');
  });

  test('handles chrome runtime error', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc123' }]);
    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      chrome.runtime.lastError = { message: 'Content script not loaded' };
      callback(undefined);
    });

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Error: Content script not loaded');
  });

  test('successful extraction shows result and triggers download', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc123' }]);
    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      callback({
        success: true,
        data: {
          metadata: {
            title: 'Test Chat',
            conversationId: 'abc123',
            messageCount: 4,
            imageCount: 2,
            extractionErrors: []
          },
          messages: []
        },
        images: [],
        warnings: []
      });
    });

    await handleExtract();

    // Result should be visible
    const resultEl = document.getElementById('result');
    expect(resultEl.classList.contains('visible')).toBe(true);
    expect(document.getElementById('messageCount').textContent).toBe('4');
    expect(document.getElementById('imageCount').textContent).toBe('2');

    // Download should be triggered
    expect(chrome.downloads.download).toHaveBeenCalled();
  });

  test('shows warning status when extraction has warnings', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc123' }]);
    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      callback({
        success: true,
        data: {
          metadata: {
            title: 'Test Chat',
            conversationId: 'abc123',
            messageCount: 4,
            imageCount: 2,
            extractionErrors: []
          },
          messages: []
        },
        images: [],
        warnings: ['Some images failed to load']
      });
    });

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toContain('warnings');
    expect(statusEl.className).toBe('status warning');
  });

  test('re-enables button after completion', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://gemini.google.com/app/abc123' }]);
    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      callback({
        success: true,
        data: {
          metadata: {
            title: 'Test',
            conversationId: 'abc123',
            messageCount: 1,
            imageCount: 0,
            extractionErrors: []
          },
          messages: []
        },
        images: [],
        warnings: []
      });
    });

    await handleExtract();

    const extractBtn = document.getElementById('extractBtn');
    expect(extractBtn.disabled).toBe(false);
  });
});

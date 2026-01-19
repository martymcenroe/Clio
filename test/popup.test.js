/**
 * Unit tests for popup.js
 *
 * Tests UI helper functions, filename sanitization, size estimation,
 * zip creation, and download functionality.
 */

const {
  sanitizeFilename,
  estimateExportSize,
  formatBytes,
  setStatus,
  showProgress,
  hideProgress,
  showResult,
  setButtonState,
  createZip,
  downloadBlob,
  handleExtract
} = require('../extension/src/popup.js');

// Set up DOM before each test
beforeEach(() => {
  setFixture('popup.html');
});

// ============================================================================
// Pure Functions
// ============================================================================

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

  test('sets turn count', () => {
    showResult(10, 5, 2);
    const turnCountEl = document.getElementById('turnCount');
    expect(turnCountEl.textContent).toBe('10');
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
    expect(document.getElementById('turnCount').textContent).toBe('0');
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
// Zip Creation
// ============================================================================

describe('createZip', () => {
  test('creates zip with conversation.json', async () => {
    const data = {
      metadata: { title: 'Test Conversation' },
      turns: []
    };
    const images = [];

    const blob = await createZip(data, images);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');
  });

  test('creates zip with images', async () => {
    const data = {
      metadata: { title: 'Test Conversation' },
      turns: []
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
      turns: []
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
      turns: []
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
    expect(statusEl.textContent).toBe('Please open a Gemini conversation first.');
    expect(statusEl.className).toBe('status error');
  });

  test('shows error when no tab found', async () => {
    chrome.tabs.query.mockResolvedValue([null]);

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Please open a Gemini conversation first.');
  });

  test('shows error when tab has no URL', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1 }]); // no url property

    await handleExtract();

    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Please open a Gemini conversation first.');
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
            turnCount: 4,
            imageCount: 2,
            extractionErrors: []
          },
          turns: []
        },
        images: [],
        warnings: []
      });
    });

    await handleExtract();

    // Result should be visible
    const resultEl = document.getElementById('result');
    expect(resultEl.classList.contains('visible')).toBe(true);
    expect(document.getElementById('turnCount').textContent).toBe('4');
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
            turnCount: 4,
            imageCount: 2,
            extractionErrors: []
          },
          turns: []
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
            turnCount: 1,
            imageCount: 0,
            extractionErrors: []
          },
          turns: []
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

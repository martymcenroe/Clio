/**
 * Unit tests for background.js (service worker)
 *
 * Tests Chrome event listener registration and handler behavior.
 */

describe('background.js', () => {
  let onInstalledCallback;
  let onChangedCallback;
  let consoleLogSpy;

  beforeEach(() => {
    // Clear mocks
    chrome.runtime.onInstalled.addListener.mockClear();
    chrome.downloads.onChanged.addListener.mockClear();

    // Spy on console.log
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    // Reset module cache to re-run registration
    jest.resetModules();

    // Capture the callbacks when background.js is loaded
    chrome.runtime.onInstalled.addListener.mockImplementation((cb) => {
      onInstalledCallback = cb;
    });
    chrome.downloads.onChanged.addListener.mockImplementation((cb) => {
      onChangedCallback = cb;
    });

    // Load the module
    require('../extension/src/background.js');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Event Listener Registration', () => {
    test('registers onInstalled listener', () => {
      expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
      expect(typeof onInstalledCallback).toBe('function');
    });

    test('registers onChanged listener', () => {
      expect(chrome.downloads.onChanged.addListener).toHaveBeenCalledTimes(1);
      expect(typeof onChangedCallback).toBe('function');
    });
  });

  describe('onInstalled Handler', () => {
    test('logs install event', () => {
      onInstalledCallback({ reason: 'install' });
      expect(consoleLogSpy).toHaveBeenCalledWith('Clio installed/updated:', 'install');
    });

    test('logs update event', () => {
      onInstalledCallback({ reason: 'update' });
      expect(consoleLogSpy).toHaveBeenCalledWith('Clio installed/updated:', 'update');
    });

    test('logs browser_update event', () => {
      onInstalledCallback({ reason: 'browser_update' });
      expect(consoleLogSpy).toHaveBeenCalledWith('Clio installed/updated:', 'browser_update');
    });
  });

  describe('onChanged Handler', () => {
    test('logs when download completes', () => {
      onChangedCallback({
        id: 123,
        state: { current: 'complete' }
      });
      expect(consoleLogSpy).toHaveBeenCalledWith('Download completed:', 123);
    });

    test('does not log when download is in progress', () => {
      onChangedCallback({
        id: 123,
        state: { current: 'in_progress' }
      });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('does not log when state is not provided', () => {
      onChangedCallback({
        id: 123,
        filename: { current: 'test.zip' }
      });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('does not log when delta has no state property', () => {
      onChangedCallback({ id: 123 });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * Unit tests for background.js (service worker)
 *
 * Tests Chrome event listener registration. The console.log behavior these
 * tests previously asserted was removed in #151 to keep the source clean
 * for the Chrome Web Store reviewer; the listener registrations remain as
 * no-op stubs because the manifest declares them.
 */

describe('background.js', () => {
  let onInstalledCallback;
  let onChangedCallback;
  let consoleLogSpy;

  beforeEach(() => {
    chrome.runtime.onInstalled.addListener.mockClear();
    chrome.downloads.onChanged.addListener.mockClear();

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    jest.resetModules();

    chrome.runtime.onInstalled.addListener.mockImplementation((cb) => {
      onInstalledCallback = cb;
    });
    chrome.downloads.onChanged.addListener.mockImplementation((cb) => {
      onChangedCallback = cb;
    });

    require('../extensions/src/background.js');
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

  describe('Handlers are silent (no debug logging)', () => {
    test('onInstalled handler does not call console.log', () => {
      onInstalledCallback({ reason: 'install' });
      onInstalledCallback({ reason: 'update' });
      onInstalledCallback({ reason: 'browser_update' });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    test('onChanged handler does not call console.log', () => {
      onChangedCallback({ id: 123, state: { current: 'complete' } });
      onChangedCallback({ id: 123, state: { current: 'in_progress' } });
      onChangedCallback({ id: 123 });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});

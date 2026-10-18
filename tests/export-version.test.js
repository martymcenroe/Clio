/**
 * Which Clio made an export (#419).
 *
 * Every live check on 2026-10-18 needed a separate step to prove a ZIP came
 * from the build under test: read the loaded version on chrome://extensions,
 * reload the tab. A ZIP looked at later carried no such proof.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const { clioVersion, extractConversation, setScrollConfig, resetScrollConfig } = require('../extensions/src/content.js');
const { SELECTORS } = require('../extensions/src/selectors-chatgpt.js');

const FAST = {
  scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 5, mutationTimeout: 10,
  maxScrollAttempts: 3, loadingCheckInterval: 5, maxLoadingWait: 20,
  progressUpdateInterval: 2, topSettleRounds: 1, minTopWaitMs: 0
};

beforeEach(() => {
  global.SELECTORS = SELECTORS;
  setScrollConfig(FAST);
  document.body.innerHTML = '<main><div data-message-author-role="user" data-message-id="u1"><div class="whitespace-pre-wrap">hi</div></div></main>';
});

afterEach(() => {
  resetScrollConfig();
  delete chrome.runtime.getManifest;
});

test('T1: an export from the extension carries the manifest version', async () => {
  chrome.runtime.getManifest = () => ({ version: '9.9.9' });
  expect(clioVersion()).toBe('9.9.9');
  const result = await extractConversation();
  expect(result.success).toBe(true);
  expect(result.data.metadata.clioVersion).toBe('9.9.9');
});

test('T2: outside the extension the version is null, never a guess, and extraction still works', async () => {
  expect(chrome.runtime.getManifest).toBeUndefined();
  expect(clioVersion()).toBeNull();
  const result = await extractConversation();
  expect(result.success).toBe(true);
  expect(result.data.metadata).toHaveProperty('clioVersion', null);
});

test('a manifest that throws is null too', () => {
  chrome.runtime.getManifest = () => { throw new Error('context invalidated'); };
  expect(clioVersion()).toBeNull();
});

/**
 * "Extract anyway" (#435): a page showing a reply being generated is refused
 * by default, and the refusal offers a way past it, because a site stuck in
 * that state (a conversation at its length limit, "thinking" for good) never
 * clears and could not be saved at all. An export taken that way is marked.
 *
 * T1-T5 of #435.
 */

const fs = require('fs');
const path = require('path');

const content = require('../extensions/src/content.js');
// The listener content.js registered when it loaded, taken before the setup
// file's beforeEach clears the mock's calls.
const onMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];
const popup = require('../extensions/src/popup.js');
const { SELECTORS } = require('../extensions/src/selectors.js');

global.SELECTORS = SELECTORS;

const FAST_SCROLL_CONFIG = {
  scrollStep: 100,
  scrollDelay: 10,
  loadingAppearDelay: 5,
  mutationTimeout: 50,
  maxScrollAttempts: 20,
  loadingCheckInterval: 10,
  maxLoadingWait: 100,
  progressUpdateInterval: 2
};

const GENERATING_REASON = 'showed a reply still being generated';

function showGenerating() {
  const el = document.createElement('div');
  el.setAttribute('data-streaming', 'true');
  document.body.appendChild(el);
}

describe('extractConversation while the page shows a reply being generated', () => {
  beforeEach(() => {
    content.setScrollConfig(FAST_SCROLL_CONFIG);
    setFixture('gemini-conversation.html');
  });

  afterEach(() => {
    content.resetScrollConfig();
  });

  // T1 (R5)
  test('refuses by default, and says the refusal is about generation', async () => {
    showGenerating();
    const result = await content.extractConversation();
    expect(result.success).toBe(false);
    expect(result.generating).toBe(true);
    expect(result.error).toContain('currently generating a response');
  });

  // T2 (R2, R3)
  test('extracts when asked to, and marks the export incomplete', async () => {
    showGenerating();
    const result = await content.extractConversation({ whileGenerating: true });
    expect(result.success).toBe(true);
    expect(result.data.messages.length).toBe(4);
    const meta = result.data.metadata;
    expect(meta.extractedWhileGenerating).toBe(true);
    expect(meta.contentComplete).toBe(false);
    expect(meta.incompleteReasons.some(r => r.includes(GENERATING_REASON))).toBe(true);
  });

  // T3 (R4)
  test('with nothing generating, the option changes nothing', async () => {
    const result = await content.extractConversation({ whileGenerating: true });
    expect(result.success).toBe(true);
    const meta = result.data.metadata;
    expect(meta.extractedWhileGenerating).toBe(false);
    expect(meta.incompleteReasons.some(r => r.includes(GENERATING_REASON))).toBe(false);
  });

  test('a plain extraction reports extractedWhileGenerating: false', async () => {
    const result = await content.extractConversation();
    expect(result.success).toBe(true);
    expect(result.data.metadata.extractedWhileGenerating).toBe(false);
  });

  // T5, the content side: the popup's message reaches extractConversation.
  test('the message listener passes whileGenerating through', async () => {
    showGenerating();
    const forced = await new Promise(resolve =>
      onMessage({ action: 'extract', whileGenerating: true }, {}, resolve));
    expect(forced.success).toBe(true);
    expect(forced.data.metadata.extractedWhileGenerating).toBe(true);

    const plain = await new Promise(resolve =>
      onMessage({ action: 'extract' }, {}, resolve));
    expect(plain.success).toBe(false);
    expect(plain.generating).toBe(true);
  });
});

describe('the popup\'s Extract anyway button', () => {
  const GENERATING_ERROR =
    'ChatGPT is currently generating a response. Please wait for completion before extracting.';
  const button = () => document.getElementById('extractAnywayBtn');

  beforeEach(() => {
    setFixture('popup.html');
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://chatgpt.com/c/abc123' }]);
  });

  test('is in the shipped popup, hidden until a refusal', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'extensions', 'src', 'popup.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.getElementById('extractAnywayBtn');
    expect(el).not.toBeNull();
    expect(el.style.display).toBe('none');
  });

  // T4 (R1)
  test('appears after a refusal because the page is generating', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) =>
      cb({ success: false, generating: true, error: GENERATING_ERROR }));
    await popup.handleExtract();
    expect(button().style.display).toBe('block');
    const status = document.getElementById('status');
    expect(status.textContent).toContain(GENERATING_ERROR);
    expect(status.textContent).toContain('Extract anyway');
  });

  test('does not appear after any other refusal', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) =>
      cb({ success: false, error: 'No conversation found' }));
    await popup.handleExtract();
    expect(button().style.display).toBe('none');
  });

  // T4 (R6)
  test('is hidden as soon as an extraction starts', async () => {
    popup.showExtractAnyway(true);
    chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
    popup.handleExtract();
    await Promise.resolve();
    expect(button().style.display).toBe('none');
  });

  // T5 (R2, R5)
  test('a plain extraction does not ask to extract while generating', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) =>
      cb({ success: false, error: 'x' }));
    await popup.handleExtract();
    expect(chrome.tabs.sendMessage.mock.calls[0][1]).toEqual({ action: 'extract' });
  });

  test('Extract anyway asks to extract while generating', async () => {
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) =>
      cb({ success: false, error: 'x' }));
    await popup.handleExtract({ whileGenerating: true });
    expect(chrome.tabs.sendMessage.mock.calls[0][1])
      .toEqual({ action: 'extract', whileGenerating: true });
  });

  test('the retry after re-injecting the content script keeps the request', async () => {
    let calls = 0;
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      calls++;
      if (calls === 1) {
        chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
        cb(undefined);
        chrome.runtime.lastError = null;
      } else {
        cb({ success: false, error: 'x' });
      }
    });
    chrome.scripting.executeScript.mockResolvedValue([]);
    await popup.sendExtractMessage({ id: 1, url: 'https://chatgpt.com/c/abc123' }, { whileGenerating: true });
    expect(chrome.tabs.sendMessage.mock.calls.length).toBe(2);
    expect(chrome.tabs.sendMessage.mock.calls[1][1])
      .toEqual({ action: 'extract', whileGenerating: true });
  });

  test('clicking the buttons sends the right request', async () => {
    jest.isolateModules(() => {
      require('../extensions/src/popup.js');
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) =>
      cb({ success: false, error: 'x' }));

    document.getElementById('extractBtn').click();
    await new Promise(r => setTimeout(r, 0));
    button().click();
    await new Promise(r => setTimeout(r, 0));

    const sent = chrome.tabs.sendMessage.mock.calls.map(c => c[1]);
    expect(sent).toEqual([
      { action: 'extract' },
      { action: 'extract', whileGenerating: true }
    ]);
  });
});

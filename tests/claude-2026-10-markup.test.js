/**
 * Claude's 2026-10 markup (#409) and the walk to the bottom (#413).
 *
 * Measured through the real extension on 2026-10-17: a one-exchange Claude
 * test conversation exported the user's message and none of Claude's reply,
 * reporting contentComplete: true. Then, live, four more defects on the way to
 * a full capture of an 18-message conversation:
 *
 *   - the transcript virtualizes (3 to 11 of 18 rows in the DOM at once), and
 *     Claude was read from the live DOM after the scroll;
 *   - findScrollContainer() picked the conversation-list sidebar, ahead of the
 *     transcript in the document, and scrolled that;
 *   - the walk only went up, so starting from the top exported 7 of 18;
 *   - a button label carrying a message's own text ("…You said: Stop …") made
 *     the streaming test claim Claude was still generating.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const {
  validateSelectors,
  countMessages,
  queryMessages,
  messageIdOf,
  claudeRoleOf,
  captureRenderedMessages,
  getCapturedMessageEls,
  resetMessageCache,
  extractTurnsClaude,
  isStreaming,
  findScrollContainer,
  splitSelectorList,
  countImagesOffered,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: CLAUDE } = require('../extensions/src/selectors-claude.js');
const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

const USER_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const REPLY_ID = 'bbbbbbbb-0000-4000-8000-00000000000b';
const UPLOAD = 'blob:https://claude.ai/aaaaaaaa-0000-4000-8000-0000000000a1';

const originalFetch = global.fetch;

function use(selectors) {
  global.SELECTORS = selectors;
  if (typeof window !== 'undefined') window.SELECTORS = selectors;
}

function sized(el, { scrollHeight, clientHeight }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.style.overflowY = 'auto';
  return el;
}

beforeEach(() => {
  use(CLAUDE);
  resetMessageCache();
  document.body.innerHTML = loadFixture('claude-conversation-2026-10.html');
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['png'], { type: 'image/png' }) }));
});

afterEach(() => {
  global.fetch = originalFetch;
  resetMessageCache();
  use(GEMINI);
});

describe('the defect (#409)', () => {
  test('the 1.9.3 assistant selector finds no reply on the 2026-10 markup', () => {
    expect(document.querySelectorAll('.font-claude-response:not(.font-claude-response-body)')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(1);
  });
});

describe('messages, roles and ids', () => {
  test('one element per message: the user row, not also the bubble inside it', () => {
    const els = queryMessages(document);
    expect(els).toHaveLength(2);
    expect(els[0].matches('[data-user-scope] [data-turn-key]')).toBe(true);
    expect(countMessages()).toBe(2);
    expect(validateSelectors()).toEqual({ valid: true, missing: [] });
  });

  test('id is data-turn-key', () => {
    expect(queryMessages(document).map(messageIdOf)).toEqual([USER_ID, REPLY_ID]);
  });

  test('role is read from a detached clone too, which no longer sits under its row', () => {
    captureRenderedMessages();
    const clones = getCapturedMessageEls();
    expect(clones[0].parentElement).toBeNull();
    expect(clones.map(claudeRoleOf)).toEqual(['user', 'assistant']);
  });
});

describe('extracted turns', () => {
  test('both messages, text exact, the upload attached, nothing of the page chrome', async () => {
    captureRenderedMessages();
    const turns = await extractTurnsClaude();
    expect(turns.map(t => [t.role, t.id])).toEqual([['user', USER_ID], ['assistant', REPLY_ID]]);

    expect(turns[0].content).toBe('Stop and name the colours in this pattern.');
    expect(turns[0].attachments.map(a => a.originalSrc)).toEqual([UPLOAD]);

    // Until #426 this read "bands.List them": the two paragraphs ran together,
    // and the test asserted it.
    expect(turns[1].content).toBe('Red, green and blue bands.\n\nList them by size like this:\n```bash\nls -lS\n```');
    for (const leak of ['Claude responded', 'Looked at the image', 'just now', 'Copy to clipboard', 'Retry']) {
      expect(turns[1].content).not.toContain(leak);
    }
  });

  test('the collapsed status row is not exported as the reasoning', async () => {
    const turns = await extractTurnsClaude();
    expect(turns[1].thinking).toBeNull();
  });

  test('the upload is counted as offered (#410)', () => {
    expect(countImagesOffered()).toBe(1);
  });
});

describe('streaming', () => {
  test('a button whose label quotes a message containing "Stop" is not a stop button', () => {
    expect(isStreaming()).toBe(false);
  });

  test('a reply still streaming is detected', () => {
    document.querySelector('[data-testid="assistant-message"]').setAttribute('data-is-streaming', 'true');
    expect(isStreaming()).toBe(true);
  });
});

describe('scroll container', () => {
  test('the transcript is chosen over the sidebar, which comes first in the document and also scrolls', () => {
    const sidebar = sized(document.querySelector('.dframe-nav-scroll'), { scrollHeight: 1411, clientHeight: 395 });
    const transcript = sized(document.querySelector('[data-autoscroll-container]'), { scrollHeight: 22127, clientHeight: 593 });
    expect(sidebar.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(findScrollContainer()).toBe(transcript);
  });

  test('a selector list splits at top-level commas only', () => {
    expect(splitSelectorList('[aria-label="a, b"], :is(x, y) z, main')).toEqual(['[aria-label="a, b"]', ':is(x, y) z', 'main']);
  });
});

describe('a virtualized transcript started from the top (#413)', () => {
  // Six messages, two rows rendered at a time, re-rendered on every scroll, as
  // the live transcript does. Started at the top, the old walk (up only) never
  // rendered rows 2-5.
  const N = 6;
  const ROW = 100;
  function virtualize() {
    document.body.innerHTML = '<main class="flex-1 flex-col"><div data-autoscroll-container="true" id="sc"><div id="list"></div></div></main>';
    const sc = document.getElementById('sc');
    const list = document.getElementById('list');
    let top = 0;
    Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (v) => { top = Math.max(0, Math.min(v, N * ROW - 200)); render(); }, configurable: true });
    sized(sc, { scrollHeight: N * ROW, clientHeight: 200 });
    sc.getBoundingClientRect = () => ({ top: 0, height: 200 });
    function render() {
      const first = Math.floor(top / ROW);
      list.innerHTML = '';
      for (let i = first; i < Math.min(N, first + 2); i++) {
        const row = document.createElement('div');
        row.innerHTML = i % 2 === 0
          ? `<div data-user-scope><div data-turn-key="key-${i}"><div data-testid="user-message"><p>question ${i}</p></div></div></div>`
          : `<div data-testid="assistant-message" data-turn-key="key-${i}"><div data-transcript-engine-root><p>answer ${i}</p></div></div>`;
        list.appendChild(row);
        const el = row.querySelector('[data-turn-key]');
        el.getBoundingClientRect = () => ({ top: i * ROW - top, height: ROW });
      }
    }
    render();
    return sc;
  }

  const FAST = {
    scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 1, mutationTimeout: 10,
    maxScrollAttempts: 60, loadingCheckInterval: 5, maxLoadingWait: 20,
    progressUpdateInterval: 2, minTopWaitMs: 0
  };
  beforeEach(() => setScrollConfig(FAST));
  afterEach(() => resetScrollConfig());

  test('read the 1.9.3 way — live DOM, walk up only — the same list exports just the starting window', async () => {
    use({ ...CLAUDE, ordersFromCapture: false });
    virtualize();
    const result = await extractConversation();
    expect(result.data.messages.map(m => m.id)).toEqual(['key-0', 'key-1']);
  });

  test('every message is captured, in order, and the walk says it reached the end', async () => {
    virtualize();
    const result = await extractConversation();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.data.messages.map(m => m.id)).toEqual(['key-0', 'key-1', 'key-2', 'key-3', 'key-4', 'key-5']);
    expect(result.data.metadata.scrollInfo.reachedBottom).toBe(true);
    expect(result.data.metadata.incompleteReasons.filter(r => /end of the conversation/.test(r))).toEqual([]);
  });
});

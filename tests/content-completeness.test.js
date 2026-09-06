/**
 * A clean capture must be able to report clean (#280).
 *
 * Across five ChatGPT exports, four carried `partialSuccess: true`, and in
 * every one of those the cause was failed favicon fetches. In the same set one
 * capture had genuinely lost 78% of the conversation — 52 messages of at least
 * 233 — and its flag read `partialSuccess: true` too.
 *
 * The flag was therefore true for a capture that lost nothing and true for a
 * capture that lost most of the conversation, which makes it unreadable. These
 * tests pin the two apart: loss of CONTENT sets the flag, loss of MEDIA does
 * not, and the reason is always stated rather than collapsed into a bit.
 *
 * The DOM here is built rather than loaded from a fixture. jsdom implements no
 * layout, so scrollHeight and clientHeight are 0 on every element, isRealScroller
 * rejects all of them, and findScrollContainer falls back to document.body — at
 * which point showProgress()'s own status element counts as a mutation inside
 * the observed subtree and the scroll loop runs to its attempt ceiling on every
 * fixture. That warning is real but it is an artefact of the harness, and a
 * completeness test that can never observe a complete capture would assert
 * nothing.
 */

const {
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

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

const originalFetch = global.fetch;

/**
 * A scroller that behaves like a conversation already scrolled to its top:
 * scrollTop 0, nothing further to load. The loop should settle in two rounds
 * and report a completed walk.
 *
 * @param {string} extraHtml appended inside the first message
 * @param {number} startTop  where the scroller begins (0 = already at the top)
 */
function buildConversation(extraHtml = '', startTop = 0) {
  document.body.innerHTML = `
    <div id="chat-history" style="overflow-y: auto; height: 200px;">
      <div data-conversation-id="conv-abc">
        <div data-message-author-role="user">What did we decide?${extraHtml}</div>
        <div data-message-author-role="model">We decided to ship it.</div>
      </div>
    </div>`;
  const scroller = document.getElementById('chat-history');
  let top = startTop;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v) => { top = Math.max(0, v); },
    configurable: true
  });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => 2000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 200, configurable: true });
  return scroller;
}

describe('contentComplete separates content loss from media loss', () => {
  beforeEach(() => {
    global.SELECTORS = GEMINI;
    setScrollConfig(FAST_SCROLL_CONFIG);
    global.fetch = originalFetch;
  });

  afterEach(() => {
    resetScrollConfig();
    global.fetch = originalFetch;
  });

  afterAll(() => { global.fetch = originalFetch; });

  // Test ID: COMPLETE-001 — the state that was previously unreachable on any
  // conversation that cited a source or lost a single image.
  test('a capture that lost nothing reports complete', async () => {
    buildConversation();

    const md = (await extractConversation()).data.metadata;

    expect(md.contentComplete).toBe(true);
    expect(md.incompleteReasons).toEqual([]);
    expect(md.partialSuccess).toBe(false);
    expect(md.extractionErrors).toEqual([]);
    expect(md.mediaErrors).toEqual([]);
  });

  // Test ID: COMPLETE-002 — the #280 headline. An image that cannot be
  // downloaded is Fail Open by design: it costs no conversation content and
  // must not read as a lost conversation.
  test('a failed image fetch does not make the capture incomplete', async () => {
    buildConversation('<img src="https://example.com/blocked.png" alt="a real image">');
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    const md = (await extractConversation()).data.metadata;

    // The failure is reported...
    expect(md.mediaErrors.length).toBe(1);
    expect(md.mediaErrors[0].type).toBe('image_fetch');
    // ...and it is not a content loss.
    expect(md.contentComplete).toBe(true);
    expect(md.partialSuccess).toBe(false);
    expect(md.extractionErrors).toEqual([]);
  });

  // Test ID: COMPLETE-003 — the flag still has to fire on real loss, or this
  // change would just be the quieter version of the same problem.
  test('a scroll that hit the attempt ceiling reports incomplete, with a reason', async () => {
    // A scroller that can never reach the top: each assignment is undone, so
    // the loop exhausts maxScrollAttempts and warns.
    const scroller = buildConversation('', 4000);
    let top = 4000;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => top,
      set: () => { top = Math.max(1, top - 1); },
      configurable: true
    });

    const md = (await extractConversation()).data.metadata;

    expect(md.contentComplete).toBe(false);
    expect(md.partialSuccess).toBe(true);
    expect(md.incompleteReasons.length).toBeGreaterThan(0);
    expect(md.incompleteReasons.join(' ')).toMatch(/maximum scroll attempts/i);
  });

  // Test ID: COMPLETE-004 — partialSuccess is retained for existing consumers
  // and is now exactly the negation of contentComplete, nothing more.
  test('partialSuccess is the negation of contentComplete', async () => {
    buildConversation();
    const clean = (await extractConversation()).data.metadata;
    expect(clean.partialSuccess).toBe(!clean.contentComplete);

    const scroller = buildConversation('', 4000);
    let top = 4000;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => top,
      set: () => { top = Math.max(1, top - 1); },
      configurable: true
    });
    const lossy = (await extractConversation()).data.metadata;

    expect(lossy.partialSuccess).toBe(!lossy.contentComplete);
    expect(clean.partialSuccess).not.toBe(lossy.partialSuccess);
  });

  // Test ID: COMPLETE-005 — the two flags cannot drift apart: a capture is
  // incomplete exactly when it can say why.
  test('incompleteReasons is non-empty exactly when the capture is incomplete', async () => {
    buildConversation();
    const clean = (await extractConversation()).data.metadata;

    expect(clean.contentComplete).toBe(clean.incompleteReasons.length === 0);
  });
});

describe('popup error counting spans both lists', () => {
  const { totalFailureCount } = require('../extensions/src/popup.js');

  // Test ID: COMPLETE-010 — a card reading "0 errors" beside a warning row
  // saying five images could not be saved is the same untrustworthy signal
  // pointing the other way.
  test('counts content and media failures together', () => {
    expect(totalFailureCount({
      extractionErrors: [{ type: 'turn_extract' }],
      mediaErrors: [{ type: 'image_fetch' }, { type: 'image_fetch' }]
    })).toBe(3);
  });

  // Test ID: COMPLETE-011
  test('a clean capture counts zero', () => {
    expect(totalFailureCount({ extractionErrors: [], mediaErrors: [] })).toBe(0);
  });

  // Test ID: COMPLETE-012 — a result saved by a pre-#280 build has one list.
  test('falls back to the single pre-280 list', () => {
    expect(totalFailureCount({
      extractionErrors: [{ type: 'image_fetch' }, { type: 'image_fetch' }]
    })).toBe(2);
  });

  // Test ID: COMPLETE-013
  test('tolerates missing metadata', () => {
    expect(totalFailureCount(null)).toBe(0);
    expect(totalFailureCount({})).toBe(0);
  });
});

/**
 * Conversation ordering under virtualization (#264).
 *
 * On a real 155-message conversation every message was captured and the
 * transcript still opened on the wrong one, because the sort key —
 * data-testid="conversation-turn-N" — is numbered relative to the rendered
 * window and took only 14 distinct values.
 *
 * The key that does work is distance from the scroller's BOTTOM, and the reason
 * it works is arithmetic rather than luck: if the loaded range starts at
 * message f and every message is H tall, then
 *
 *     scrollHeight = (N - f) * H          offsetTop(i) = (i - f) * H
 *     fromBottom(i) = scrollHeight - offsetTop(i) = (N - i) * H
 *
 * which does not mention f at all. Prepending older content moves both terms by
 * the same amount. These tests model exactly that, so what is under test is the
 * invariant and not a fixture that happens to agree with the code.
 */

const {
  captureRenderedMessages,
  remeasureRenderedMessages,
  getCapturedMessageEls,
  getCaptureOrderStats,
  resetMessageCache,
  setMessageScroller,
  measureFromBottom,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

// Each selectors file assigns window.SELECTORS on load, so the other two must
// be required BEFORE the ChatGPT one — otherwise whichever loads last silently
// becomes the global and every test in this file runs against the wrong site.
const geminiSelectors = require('../extensions/src/selectors.js').SELECTORS;
const claudeSelectors = require('../extensions/src/selectors-claude.js').SELECTORS;

const { SELECTORS } = require('../extensions/src/selectors-chatgpt.js');
global.SELECTORS = SELECTORS;

const H = 100;           // every message is this tall
const TOTAL = 12;        // m0 .. m11, oldest first

/**
 * A scroller parked at the top of the loaded range, holding messages
 * [first .. TOTAL-1]. Returns the element so tests can hand it to the code.
 */
function renderWindow(first, last) {
  const ids = [];
  for (let i = first; i <= last; i++) ids.push(`m${i}`);

  document.body.innerHTML = `<div id="scroller">${ids.map((id, n) => `
      <div data-testid="conversation-turn-${n + 1}">
        <div data-message-author-role="${n % 2 ? 'assistant' : 'user'}"
             data-message-id="${id}">${id}</div>
      </div>`).join('')}</div>`;

  const scroller = document.getElementById('scroller');
  // Everything from `first` to the end of the conversation is loaded above and
  // below the window, so the scrollable height covers that whole range.
  const loaded = TOTAL - first;
  Object.defineProperty(scroller, 'scrollHeight', { value: loaded * H, configurable: true });
  // Deliberately shorter than the smallest window any test renders, so the
  // scroller genuinely scrolls: these tests are about the scrolling case. A
  // conversation that fits on screen, with nothing to scroll, is #407's tests
  // below.
  Object.defineProperty(scroller, 'clientHeight', { value: 2 * H, configurable: true });
  scroller.scrollTop = 0;
  scroller.getBoundingClientRect = () => ({ top: 0, height: 2 * H });

  // Each rendered message sits at its true offset within the loaded range.
  for (const el of document.querySelectorAll(SELECTORS.allMessages)) {
    const index = Number(el.getAttribute('data-message-id').slice(1));
    const top = (index - first) * H;
    el.getBoundingClientRect = () => ({ top, height: H });
  }
  return scroller;
}

const captured = () =>
  getCapturedMessageEls().map(el => el.getAttribute('data-message-id'));

beforeEach(() => {
  resetMessageCache();
  document.body.innerHTML = '';
  global.SELECTORS = SELECTORS;
});

describe('bottom-anchored ordering (#264)', () => {
  test('reconstructs the conversation from windows seen newest-first', () => {
    // The real motion: start at the bottom, scroll back, each round loading
    // older messages above. Every window renumbers conversation-turn from 1.
    setMessageScroller(renderWindow(9, 11)); captureRenderedMessages();
    setMessageScroller(renderWindow(6, 9));  captureRenderedMessages();
    setMessageScroller(renderWindow(3, 6));  captureRenderedMessages();
    setMessageScroller(renderWindow(0, 3));  captureRenderedMessages();

    expect(captured()).toEqual(
      ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']);
  });

  test('the key does not move when older content is prepended', () => {
    // The invariant, measured directly rather than inferred from an ordering.
    let scroller = renderWindow(9, 11);
    const atFirstSight = measureFromBottom(
      document.querySelector('[data-message-id="m10"]'), scroller);

    scroller = renderWindow(0, 11);   // nine older messages now loaded above
    const afterPrepending = measureFromBottom(
      document.querySelector('[data-message-id="m10"]'), scroller);

    expect(afterPrepending).toBe(atFirstSight);
  });

  test('is unaffected by conversation-turn numbering restarting each window', () => {
    // m9, m6, m3 and m0 are all conversation-turn-1 here. Ordering by that
    // testid put 141 of 155 real messages into fourteen buckets.
    setMessageScroller(renderWindow(9, 11)); captureRenderedMessages();
    setMessageScroller(renderWindow(6, 9));  captureRenderedMessages();
    setMessageScroller(renderWindow(0, 3));  captureRenderedMessages();

    const order = captured();
    expect(order[0]).toBe('m0');
    expect(order[order.length - 1]).toBe('m11');
    expect(order.indexOf('m6')).toBeLessThan(order.indexOf('m9'));
  });

  test('a re-rendered window does not duplicate or reorder anything', () => {
    setMessageScroller(renderWindow(6, 9)); captureRenderedMessages();
    setMessageScroller(renderWindow(3, 6)); captureRenderedMessages();
    setMessageScroller(renderWindow(6, 9)); captureRenderedMessages();  // scrolled back down

    expect(captured()).toEqual(['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });

  test('handles forward scrolling too', () => {
    setMessageScroller(renderWindow(0, 3)); captureRenderedMessages();
    setMessageScroller(renderWindow(3, 6)); captureRenderedMessages();
    setMessageScroller(renderWindow(6, 9)); captureRenderedMessages();

    expect(captured()).toEqual(
      ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });

  test('every captured message survives eviction', () => {
    setMessageScroller(renderWindow(6, 9)); captureRenderedMessages();
    setMessageScroller(renderWindow(0, 3)); captureRenderedMessages();

    // Only the last window is in the DOM.
    expect(document.querySelectorAll(SELECTORS.allMessages)).toHaveLength(4);
    expect(captured()).toHaveLength(8);
  });

  test('a message measured mid-render is corrected by the settled-DOM pass', () => {
    // A MutationObserver fires during a framework update, when a node is in the
    // DOM but not yet in its final position. m4 is captured with a junk offset
    // that would sort it last; the settled pass must overwrite it.
    const scroller = renderWindow(3, 6);
    const m4 = document.querySelector('[data-message-id="m4"]');
    const settledRect = m4.getBoundingClientRect;
    m4.getBoundingClientRect = () => ({ top: 5000, height: H });   // mid-update junk

    setMessageScroller(scroller);
    captureRenderedMessages();
    expect(captured()[captured().length - 1]).toBe('m4');          // wrong, as expected

    m4.getBoundingClientRect = settledRect;                        // layout settles
    expect(remeasureRenderedMessages()).toBe(4);
    expect(captured()).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(getCaptureOrderStats().neverMeasuredOnSettledDom).toBe(0);
  });

  test('a message that is never laid out is kept, counted, and appended', () => {
    const scroller = renderWindow(3, 6);
    // Height 0: in the DOM, not laid out. A measurement here would be junk, so
    // there must not be one — but the message must not go missing either.
    document.querySelector('[data-message-id="m5"]')
      .getBoundingClientRect = () => ({ top: 0, height: 0 });

    setMessageScroller(scroller);
    captureRenderedMessages();

    const order = captured();
    expect(order).toHaveLength(4);
    expect(order).toContain('m5');
    expect(order[order.length - 1]).toBe('m5');      // appended, not dropped

    const stats = getCaptureOrderStats();
    expect(stats.captured).toBe(4);
    expect(stats.withoutOrderKey).toBe(1);           // the failure is reported
  });

  test('with no scroller at all, capture order is kept rather than invented', () => {
    // One sweep of a page that never scrolled: capture order IS document order,
    // which is correct. Nothing should be reordered on a guess.
    renderWindow(0, 5);
    setMessageScroller(null);
    captureRenderedMessages();

    expect(captured()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    expect(getCaptureOrderStats().withoutOrderKey).toBe(6);
  });

  // Until #407 this test read "a container that does not scroll yields no
  // key", and asserted it for a container with nothing scrolling inside it
  // either: a conversation that fits on screen. That rule is what flagged every
  // short conversation. The key is meaningless only when something BETWEEN the
  // container and the message scrolls, so that is what is held here (#407 R2).
  test('a non-scrolling container with a real scroller inside it yields no key', () => {
    const inner = renderWindow(0, 3);          // scrolls: 12H of content, 2H tall
    inner.style.overflowY = 'auto';
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    outer.appendChild(inner);
    Object.defineProperty(outer, 'scrollHeight', { value: 2 * H, configurable: true });
    Object.defineProperty(outer, 'clientHeight', { value: 2 * H, configurable: true });
    outer.getBoundingClientRect = () => ({ top: 0, height: 2 * H });

    const el = document.querySelector('[data-message-id="m1"]');
    expect(measureFromBottom(el, outer)).toBeNull();

    setMessageScroller(outer);
    captureRenderedMessages();
    expect(getCaptureOrderStats().withoutOrderKey).toBe(4);   // still reported
  });

  test('a non-scrolling container that does not hold the message yields no key', () => {
    renderWindow(0, 3);
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    Object.defineProperty(elsewhere, 'scrollHeight', { value: H, configurable: true });
    Object.defineProperty(elsewhere, 'clientHeight', { value: H, configurable: true });
    elsewhere.getBoundingClientRect = () => ({ top: 0, height: H });

    expect(measureFromBottom(document.querySelector('[data-message-id="m1"]'), elsewhere)).toBeNull();
  });

  test('the live DOM is used when nothing was captured', () => {
    renderWindow(0, 3);
    expect(captured()).toEqual(['m0', 'm1', 'm2', 'm3']);
  });
});

// ============================================================================
// A conversation that fits on screen (#407)
// ============================================================================

/**
 * Measured live: a 4-message conversation in a viewport tall enough to hold it
 * has nothing to scroll, findScrollContainer() falls back to <body>, and until
 * #407 measureFromBottom() refused every message because <body> does not
 * scroll. Every short conversation exported contentComplete: false with "4 of
 * 4 message(s) could not be positioned". Nothing between <body> and the
 * messages scrolls, so nothing can move, and the distance from the bottom is
 * an exact key.
 */
describe('a conversation that fits on screen is positioned (#407)', () => {
  /**
   * Three messages, laid out m0, m1, m2 from the top, but in the DOM as m2, m0,
   * m1, so ordering by position and ordering by capture give different answers.
   * The scroller is exactly as tall as its content.
   */
  function renderFitting(scrollerIsBody) {
    const order = ['m2', 'm0', 'm1'];
    const html = order.map((id) => `
      <div><div data-message-author-role="${id === 'm1' ? 'assistant' : 'user'}"
                data-message-id="${id}">${id}</div></div>`).join('');
    document.body.innerHTML = scrollerIsBody ? html : `<div id="scroller">${html}</div>`;
    const scroller = scrollerIsBody ? document.body : document.getElementById('scroller');
    Object.defineProperty(scroller, 'scrollHeight', { value: 3 * H, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 3 * H, configurable: true });
    scroller.getBoundingClientRect = () => ({ top: 0, height: 3 * H });
    for (const el of document.querySelectorAll(SELECTORS.allMessages)) {
      const index = Number(el.getAttribute('data-message-id').slice(1));
      el.getBoundingClientRect = () => ({ top: index * H, height: H });
    }
    return scroller;
  }

  test('every message gets a key, from its position', () => {
    const scroller = renderFitting(false);
    const keys = ['m0', 'm1', 'm2'].map((id) =>
      measureFromBottom(document.querySelector(`[data-message-id="${id}"]`), scroller));
    expect(keys).toEqual([3 * H, 2 * H, H]);
  });

  test('the transcript is ordered by position, not capture order', () => {
    setMessageScroller(renderFitting(false));
    captureRenderedMessages();
    expect(captured()).toEqual(['m0', 'm1', 'm2']);
    expect(getCaptureOrderStats().withoutOrderKey).toBe(0);
  });

  test('with <body> as the scroller, as findScrollContainer() returns when nothing scrolls', () => {
    setMessageScroller(renderFitting(true));
    captureRenderedMessages();
    expect(captured()).toEqual(['m0', 'm1', 'm2']);
    expect(getCaptureOrderStats().withoutOrderKey).toBe(0);
  });

  test('the settled-DOM pass measures them too', () => {
    setMessageScroller(renderFitting(true));
    captureRenderedMessages();
    expect(remeasureRenderedMessages()).toBe(3);
    expect(getCaptureOrderStats().neverMeasuredOnSettledDom).toBe(0);
  });

  describe('through the whole extraction', () => {
    const FAST = {
      scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 5, mutationTimeout: 10,
      maxScrollAttempts: 5, loadingCheckInterval: 5, maxLoadingWait: 20,
      progressUpdateInterval: 2, topSettleRounds: 1, minTopWaitMs: 0
    };
    beforeEach(() => setScrollConfig(FAST));
    afterEach(() => resetScrollConfig());

    test('the export is complete and makes no ordering complaint', async () => {
      document.body.innerHTML = `
        <main>
          <div data-message-author-role="user" data-message-id="c1">
            <div class="whitespace-pre-wrap">hello</div>
          </div>
          <div data-message-author-role="assistant" data-message-id="c2">
            <div class="markdown">hi there</div>
          </div>
        </main>`;
      // jsdom: nothing has a size, so nothing scrolls and findScrollContainer()
      // returns <body>, exactly as live. Only the messages are laid out.
      document.querySelector('[data-message-id="c1"]').getBoundingClientRect = () => ({ top: 0, height: H });
      document.querySelector('[data-message-id="c2"]').getBoundingClientRect = () => ({ top: H, height: H });

      const result = await extractConversation();

      expect(result.success).toBe(true);
      const meta = result.data.metadata;
      expect(meta.orderInfo.withoutOrderKey).toBe(0);
      expect(meta.incompleteReasons.join(' ')).not.toContain('could not be positioned');
      expect(result.warnings.join(' ')).not.toContain('could not be positioned');
      expect(meta.contentComplete).toBe(true);
      expect(result.data.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });
  });
});

// ============================================================================
// The ordering report belongs only to the site that uses it (#272)
// ============================================================================

/**
 * The shared scroll path populates the capture cache on every site, but only
 * ChatGPT extracts from it — extractTurnsGemini and extractTurnsClaude read the
 * live DOM. So the cache's ordering confidence says nothing about a Gemini or
 * Claude export, and reporting it there, or warning about it, describes
 * something that did not happen.
 *
 * Today nothing is cached on those sites because their messages carry no
 * data-message-id or data-turn-id. That makes the behaviour correct by accident
 * of a DOM this repo does not control: the day Gemini adds one, every export
 * from the most-used path would start declaring a degraded extraction. These
 * tests hold the property instead of the attribute.
 */
describe('order reporting is scoped to the site that orders from capture (#272)', () => {
  // jsdom lays nothing out, so every captured message is unmeasurable and
  // withoutOrderKey is non-zero by construction — which is exactly the
  // condition under test.
  const FAST = {
    scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 5, mutationTimeout: 10,
    maxScrollAttempts: 3, loadingCheckInterval: 5, maxLoadingWait: 20,
    progressUpdateInterval: 2
  };

  beforeEach(() => setScrollConfig(FAST));
  afterEach(() => {
    resetScrollConfig();
    global.SELECTORS = SELECTORS;
  });

  test('each site states whether its export is ordered from the capture cache', () => {
    expect(SELECTORS.ordersFromCapture).toBe(true);
    expect(geminiSelectors.ordersFromCapture).toBe(false);
    // Claude moved to the capture cache in #409: its 2026-10 transcript
    // virtualizes (3 to 11 of 18 rows in the DOM at once, measured live), so
    // its export IS ordered from the cache now and the report is about it.
    expect(claudeSelectors.ordersFromCapture).toBe(true);
  });

  test('a Gemini message carrying an id is cached but raises no false alarm', async () => {
    // The future being guarded against: Gemini gains a data-message-id, so its
    // messages become cacheable, and unmeasurable ones would otherwise report a
    // positioning failure on an export that never consulted the cache.
    global.SELECTORS = geminiSelectors;
    document.body.innerHTML = `
      <div class="conversation-container">
        <user-query data-message-id="g1"><div class="query-text">hello</div></user-query>
        <model-response data-message-id="g2"><message-content>hi there</message-content></model-response>
      </div>`;

    const result = await extractConversation();

    expect(result.success).toBe(true);
    // The condition that would trigger the warning is genuinely present...
    expect(getCaptureOrderStats().withoutOrderKey).toBeGreaterThan(0);
    // ...and is correctly not reported, because this export did not use it.
    expect(result.warnings.join(' ')).not.toContain('could not be positioned');
    expect(result.data.metadata.orderInfo).toBeUndefined();
  });

  test('on ChatGPT the same condition IS reported', async () => {
    global.SELECTORS = SELECTORS;
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user" data-message-id="c1">
          <div class="whitespace-pre-wrap">hello</div>
        </div>
        <div data-message-author-role="assistant" data-message-id="c2">
          <div class="markdown">hi there</div>
        </div>
      </main>`;

    const result = await extractConversation();

    expect(result.success).toBe(true);
    expect(result.warnings.join(' ')).toContain('could not be positioned');
    expect(result.data.metadata.orderInfo.withoutOrderKey).toBeGreaterThan(0);
    expect(result.data.metadata.partialSuccess).toBe(true);
  });

  test('a clean ChatGPT capture reports its confidence without warning', async () => {
    // The counterpart that keeps the assertion above honest: orderInfo must be
    // present whenever the site orders from capture, not only when something
    // went wrong, and a fully measured capture must not warn.
    global.SELECTORS = SELECTORS;
    setMessageScroller(renderWindow(0, 3));
    captureRenderedMessages();

    expect(getCaptureOrderStats().withoutOrderKey).toBe(0);
    expect(getCaptureOrderStats().withOrderKey).toBe(4);
  });
});

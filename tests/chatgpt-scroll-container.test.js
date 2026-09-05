/**
 * Regression tests for ChatGPT scroll-back (#255, #256).
 *
 * Both defects were found against the live page, not against fixtures — the
 * real scroller turned out to be an ANCESTOR of <main>, which no amount of
 * reading the source suggested. These tests pin the two behaviours that were
 * wrong so they cannot come back:
 *
 *   #255  a tall element with overflow:visible is NOT a scroll container, and
 *         a selector list must be honoured in selector order, not document
 *         order.
 *   #256  messages evicted by virtualization must survive to extraction.
 */

const {
  isRealScroller,
  findScrollContainer,
  captureRenderedMessages,
  getCapturedMessageEls,
  resetMessageCache,
  setMessageScroller
} = require('../extensions/src/content.js');

const { SELECTORS } = require('../extensions/src/selectors-chatgpt.js');

global.SELECTORS = SELECTORS;

/** Put each message at a known offset; jsdom lays nothing out on its own. */
function placeAt(offsets) {
  for (const [id, top] of Object.entries(offsets)) {
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (el) el.getBoundingClientRect = () => ({ top, height: 100 });
  }
}

/** jsdom reports 0 for layout metrics; state them explicitly. */
function sized(el, { scrollHeight, clientHeight, overflowY }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  if (overflowY) el.style.overflowY = overflowY;
  return el;
}

/**
 * The layout measured on the live page 2026-09-05:
 *
 *   div.group/scroll-root      overflow-y:auto   4313/950   <-- real scroller
 *     > div.contents
 *       > main#main            overflow:visible  4261/898   <-- what Clio took
 */
function buildChatGPTLayout() {
  document.body.innerHTML = `
    <div id="scroll-root">
      <div class="contents">
        <main id="main">
          <div data-testid="conversation-turn-2">
            <div data-message-author-role="user" data-message-id="m-1">
              <div class="whitespace-pre-wrap">first</div>
            </div>
          </div>
          <div data-testid="conversation-turn-3">
            <div data-message-author-role="assistant" data-message-id="m-2">
              <div class="markdown">reply</div>
            </div>
          </div>
        </main>
      </div>
    </div>`;

  const root = document.getElementById('scroll-root');
  const main = document.getElementById('main');
  sized(root, { scrollHeight: 4313, clientHeight: 950, overflowY: 'auto' });
  sized(main, { scrollHeight: 4261, clientHeight: 898, overflowY: 'visible' });
  return { root, main };
}

beforeEach(() => {
  resetMessageCache();
  document.body.innerHTML = '';
});

describe('isRealScroller (#255)', () => {
  test('a tall element with overflow:visible is not a scroller', () => {
    const { main } = buildChatGPTLayout();
    // The old test — scrollHeight > clientHeight — is true here.
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
    // ...and it is still not something you can scroll.
    expect(isRealScroller(main)).toBe(false);
  });

  test('an element with overflow-y:auto that overflows is a scroller', () => {
    const { root } = buildChatGPTLayout();
    expect(isRealScroller(root)).toBe(true);
  });

  test('an overflow-y:auto element that does not overflow is not a scroller', () => {
    document.body.innerHTML = '<div id="x"></div>';
    const el = sized(document.getElementById('x'), {
      scrollHeight: 200, clientHeight: 200, overflowY: 'auto'
    });
    expect(isRealScroller(el)).toBe(false);
  });
});

describe('findScrollContainer (#255)', () => {
  test('does not return <main> when <main> cannot scroll', () => {
    const { main } = buildChatGPTLayout();
    expect(findScrollContainer()).not.toBe(main);
  });

  test('finds the real scroller even though it is an ANCESTOR of <main>', () => {
    const { root } = buildChatGPTLayout();
    expect(findScrollContainer()).toBe(root);
  });

  test('honours selector order rather than document order', () => {
    // 'main [class*="overflow-y-auto"], main' means "prefer the inner div".
    // querySelector() returns document-order-first, so <main> used to win.
    document.body.innerHTML = `
      <main id="main">
        <div id="inner" class="overflow-y-auto">
          <div data-message-author-role="user" data-message-id="m-1">hi</div>
        </div>
      </main>`;
    const main = document.getElementById('main');
    const inner = document.getElementById('inner');
    sized(main, { scrollHeight: 5000, clientHeight: 900, overflowY: 'visible' });
    sized(inner, { scrollHeight: 5000, clientHeight: 900, overflowY: 'auto' });

    expect(findScrollContainer()).toBe(inner);
  });

  test('finds a scroller nested below the conversation container', () => {
    document.body.innerHTML = `
      <main id="main">
        <div id="wrap">
          <div id="deep">
            <div data-message-author-role="user" data-message-id="m-1">hi</div>
          </div>
        </div>
      </main>`;
    const main = document.getElementById('main');
    const deep = document.getElementById('deep');
    sized(main, { scrollHeight: 100, clientHeight: 100, overflowY: 'visible' });
    sized(deep, { scrollHeight: 4000, clientHeight: 900, overflowY: 'scroll' });

    expect(findScrollContainer()).toBe(deep);
  });
});

describe('message capture under virtualization (#256)', () => {
  test('keeps messages that are later evicted from the DOM', () => {
    buildChatGPTLayout();
    expect(captureRenderedMessages()).toBe(2);

    // ChatGPT evicts the window and renders an older one in its place.
    document.querySelector('#main').innerHTML = `
      <div data-testid="conversation-turn-0">
        <div data-message-author-role="user" data-message-id="m-0">older</div>
      </div>`;
    expect(captureRenderedMessages()).toBe(1);

    // Only one message is in the DOM; all three must reach extraction.
    expect(document.querySelectorAll(SELECTORS.allMessages).length).toBe(1);
    expect(getCapturedMessageEls().length).toBe(3);
  });

  // This test originally asserted ordering by the conversation-turn testid.
  // #264 established that testid is numbered relative to the rendered window,
  // not the conversation, so that expectation was encoding the bug. Ordering
  // now comes from each message's distance from the scroller's bottom, which is
  // invariant under the prepending a scroll-back does. The mechanism is covered
  // in depth by tests/message-order.test.js; this pins that the two ChatGPT
  // repairs work together — the scroller found by #255 is the one #264 measures
  // against.
  test('places an older window ahead of a newer one by distance from the end', () => {
    const { root } = buildChatGPTLayout();          // m-1, m-2, at the bottom
    sized(root, { scrollHeight: 200, clientHeight: 100, overflowY: 'auto' });
    root.scrollTop = 0;
    root.getBoundingClientRect = () => ({ top: 0, height: 100 });
    placeAt({ 'm-1': 0, 'm-2': 100 });

    setMessageScroller(findScrollContainer());
    expect(findScrollContainer()).toBe(root);       // not <main>, per #255
    captureRenderedMessages();

    // An older message loads in above. Its height is added to scrollHeight AND
    // to every existing element's offset, which is exactly why the key holds.
    document.querySelector('#main').innerHTML = `
      <div data-testid="conversation-turn-1">
        <div data-message-author-role="user" data-message-id="m-0">older</div>
      </div>
      <div data-testid="conversation-turn-2">
        <div data-message-author-role="user" data-message-id="m-1">first</div>
      </div>`;
    sized(root, { scrollHeight: 300, clientHeight: 100, overflowY: 'auto' });
    root.getBoundingClientRect = () => ({ top: 0, height: 100 });
    placeAt({ 'm-0': 0, 'm-1': 100 });
    captureRenderedMessages();

    const ids = getCapturedMessageEls().map(el => el.getAttribute('data-message-id'));
    expect(ids).toEqual(['m-0', 'm-1', 'm-2']);
  });

  test('does not double-count a message that re-renders', () => {
    buildChatGPTLayout();
    captureRenderedMessages();
    expect(captureRenderedMessages()).toBe(0);
    expect(getCapturedMessageEls().length).toBe(2);
  });

  test('falls back to the live DOM when nothing was captured', () => {
    buildChatGPTLayout();
    resetMessageCache();
    expect(getCapturedMessageEls().length).toBe(2);
  });
});

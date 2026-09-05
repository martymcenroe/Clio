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
  measureFromBottom
} = require('../extensions/src/content.js');

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
  // Deliberately shorter than the smallest window any test renders: a viewport
  // as tall as everything loaded is not scrolling, measureFromBottom correctly
  // declines to measure it, and the ordering would then be resting on capture
  // order rather than on the key under test.
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

  test('a container that does not scroll yields no key', () => {
    const scroller = renderWindow(0, 3);
    Object.defineProperty(scroller, 'scrollHeight', { value: 3 * H, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 3 * H, configurable: true });

    const el = document.querySelector('[data-message-id="m1"]');
    expect(measureFromBottom(el, scroller)).toBeNull();
  });

  test('the live DOM is used when nothing was captured', () => {
    renderWindow(0, 3);
    expect(captured()).toEqual(['m0', 'm1', 'm2', 'm3']);
  });
});

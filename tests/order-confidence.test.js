/**
 * The ordering bug's residue is reported, not just recorded (#282).
 *
 * A 233-message export carried `neverMeasuredOnSettledDom: 35` — 15% of the
 * transcript positioned from a measurement taken while the page was still
 * moving — and nothing surfaced it. The field existed, so someone knew it
 * mattered; a reader had to know it was there, find it inside `orderInfo`, and
 * already know what a non-zero value implied.
 *
 * What the oracle says about those messages, measured before this was written:
 * `tools/chatgpt/verify-order.js` checks the reconstructed order against
 * ChatGPT's own response numbering, which is independent of every signal the
 * scraper uses. Run against a harvested 149-message capture carrying
 * `messagesNeverMeasuredOnSettledDom: 9`, it reported **0 inversions across 22
 * transitions**. So the counter looks conservative rather than a report of
 * damage — which is why this surfaces as a note and not an alarm. #280 exists
 * because a warning that overstates its case stops being read.
 */

const {
  captureRenderedMessages,
  remeasureRenderedMessages,
  resetMessageCache,
  setMessageScroller,
  getCaptureOrderStats,
  wasMeasuredOnSettledDom
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');

/** A scroller with the geometry measureFromBottom needs. */
function buildScroller(ids) {
  document.body.innerHTML = `
    <div id="scroller" style="overflow-y: auto; height: 200px;">
      ${ids.map(id => `<div data-message-author-role="assistant" data-message-id="${id}">m-${id}</div>`).join('')}
    </div>`;
  const el = document.getElementById('scroller');
  Object.defineProperty(el, 'scrollHeight', { get: () => 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
  el.getBoundingClientRect = () => ({ top: 0, bottom: 200, height: 200, left: 0, right: 0, width: 0 });
  for (const child of el.children) {
    child.getBoundingClientRect = () => ({ top: 10, bottom: 40, height: 30, left: 0, right: 0, width: 0 });
  }
  return el;
}

describe('which messages rest on an unsettled measurement is knowable', () => {
  beforeEach(() => {
    global.SELECTORS = CHATGPT;
    resetMessageCache();
  });

  // Test ID: ORDER-001 — capture alone never settles anything. That is the
  // mechanism: captureRenderedMessages() runs inside the MutationObserver,
  // mid-framework-update, because an evicted message is gone by the next tick.
  test('a message captured but never remeasured is marked unsettled', () => {
    const el = buildScroller(['a', 'b']);
    setMessageScroller(el);

    captureRenderedMessages();

    expect(wasMeasuredOnSettledDom('a')).toBe(false);
    expect(getCaptureOrderStats().neverMeasuredOnSettledDom).toBe(2);
  });

  // Test ID: ORDER-002
  test('a remeasure on a settled DOM clears it', () => {
    const el = buildScroller(['a', 'b']);
    setMessageScroller(el);
    captureRenderedMessages();

    remeasureRenderedMessages();

    expect(wasMeasuredOnSettledDom('a')).toBe(true);
    expect(getCaptureOrderStats().neverMeasuredOnSettledDom).toBe(0);
  });

  // Test ID: ORDER-003 — the eviction case, which is what produces a non-zero
  // count in a real capture: the message is gone from the DOM before any
  // remeasure sees it, so its ordering key stays the one taken mid-update.
  test('a message evicted before any remeasure stays unsettled', () => {
    const el = buildScroller(['a', 'b']);
    setMessageScroller(el);
    captureRenderedMessages();

    // Virtualization removes 'a' while 'b' remains.
    el.querySelector('[data-message-id="a"]').remove();
    remeasureRenderedMessages();

    expect(wasMeasuredOnSettledDom('a')).toBe(false);
    expect(wasMeasuredOnSettledDom('b')).toBe(true);
    expect(getCaptureOrderStats().neverMeasuredOnSettledDom).toBe(1);
  });

  // Test ID: ORDER-004 — an unknown id must answer false, not throw and not
  // claim settled. An unknown message has no settled measurement.
  test('an unknown message is not claimed as settled', () => {
    buildScroller(['a']);
    expect(wasMeasuredOnSettledDom('nope')).toBe(false);
    expect(wasMeasuredOnSettledDom(null)).toBe(false);
    expect(wasMeasuredOnSettledDom(undefined)).toBe(false);
  });
});

describe('the popup reports it without overstating it', () => {
  const { showOrderConfidence } = require('../extensions/src/popup.js');

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="orderNote" style="display: none;"><span id="orderNoteText"></span></div>`;
  });

  // Test ID: ORDER-010 — the 233-message export's own numbers.
  test('a non-zero count reaches the popup in words, not a field name', () => {
    showOrderConfidence({
      orderInfo: { capturedMessages: 233, neverMeasuredOnSettledDom: 35 }
    });

    expect(document.getElementById('orderNote').style.display).toBe('block');
    const text = document.getElementById('orderNoteText').textContent;
    expect(text).toContain('35 of 233');
    // No jargon: a reader should not need to know the field name.
    expect(text).not.toContain('neverMeasuredOnSettledDom');
  });

  // Test ID: ORDER-011 — and it stays quiet when there is nothing to say.
  test('a clean capture raises no note', () => {
    showOrderConfidence({
      orderInfo: { capturedMessages: 233, neverMeasuredOnSettledDom: 0 }
    });

    expect(document.getElementById('orderNote').style.display).toBe('none');
  });

  // Test ID: ORDER-012 — Gemini and Claude carry no orderInfo at all, because
  // they read turns from the live DOM and never consult the capture cache
  // (#272). A note about the cache's ordering would describe nothing.
  test('a site that does not order from the capture cache raises no note', () => {
    showOrderConfidence({ messageCount: 10 });

    expect(document.getElementById('orderNote').style.display).toBe('none');
  });
});

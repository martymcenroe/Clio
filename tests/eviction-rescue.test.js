/**
 * A message rendered and evicted between two sweeps must still be captured
 * (#291).
 *
 * MEASURED, not theorised. Two full extractions of one ChatGPT conversation
 * minutes apart, both reporting `contentComplete: true` and `reachedTop: true`:
 *
 *   A: 252 messages   holds 5 that B lacks
 *   B: 250 messages   holds 3 that A lacks
 *
 * Neither was a superset of the other — the exact complaint in #278 that
 * started this work, reproduced under control once #294 gave messages ids to
 * compare by.
 *
 * The mechanism: `captureRenderedMessages()` queries `document`, so it only
 * sees what is attached when it runs. By the time a MutationObserver callback
 * fires, the DOM already reflects every record in the batch — so a message
 * added and evicted inside one batch is absent from the document and present
 * only in `mutation.removedNodes`. The observer's own comment said "an evicted
 * message is gone by the next tick" directly above a call that looked in the
 * one place it could not be.
 */

const {
  captureRenderedMessages,
  captureDetachedMessages,
  getCaptureOrderStats,
  getCapturedMessageEls,
  resetMessageCache,
  setMessageScroller,
  getRescuedCount
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');

function scroller(ids) {
  document.body.innerHTML = `
    <div id="sc" style="overflow-y: auto; height: 200px;">
      ${ids.map(id => `<div data-message-author-role="assistant" data-message-id="${id}">m-${id}</div>`).join('')}
    </div>`;
  const el = document.getElementById('sc');
  Object.defineProperty(el, 'scrollHeight', { get: () => 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
  el.getBoundingClientRect = () => ({ top: 0, bottom: 200, height: 200, left: 0, right: 0, width: 0 });
  let y = 0;
  for (const child of el.children) {
    const top = (y += 30);
    child.getBoundingClientRect = () => ({ top, bottom: top + 30, height: 30, left: 0, right: 0, width: 0 });
  }
  return el;
}

/** A detached message element, as it exists inside a removedNodes list. */
function detached(id) {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'assistant');
  el.setAttribute('data-message-id', id);
  el.textContent = `m-${id}`;
  return el;
}

describe('messages evicted between sweeps are not lost', () => {
  beforeEach(() => {
    global.SELECTORS = CHATGPT;
    resetMessageCache();
  });

  // Test ID: EVICT-001 — the defect. A live-DOM sweep cannot see it.
  test('a live sweep misses a message that was already removed', () => {
    const el = scroller(['a', 'c']);
    setMessageScroller(el);

    captureRenderedMessages();

    // 'b' was rendered and evicted before this sweep; it is nowhere.
    expect(getCaptureOrderStats().captured).toBe(2);
  });

  // Test ID: EVICT-002 — and the record still holds it.
  test('the evicted message is rescued from the mutation record', () => {
    const el = scroller(['a', 'c']);
    setMessageScroller(el);
    captureRenderedMessages();

    const record = {
      type: 'childList',
      previousSibling: el.querySelector('[data-message-id="a"]'),
      nextSibling: el.querySelector('[data-message-id="c"]')
    };
    captureDetachedMessages([detached('b')], record);

    expect(getCaptureOrderStats().captured).toBe(3);
    expect(getRescuedCount()).toBe(1);
  });

  // Test ID: EVICT-003 — rescued in the RIGHT PLACE. A message restored to the
  // wrong position is worse than one that is missing: content that failed to
  // extract is visibly absent, a misplaced message reads as fluent (#282).
  test('a rescued message is positioned between the siblings it sat between', () => {
    const el = scroller(['a', 'c']);
    setMessageScroller(el);
    captureRenderedMessages();

    captureDetachedMessages([detached('b')], {
      type: 'childList',
      previousSibling: el.querySelector('[data-message-id="a"]'),
      nextSibling: el.querySelector('[data-message-id="c"]')
    });

    const order = getCapturedMessageEls()
      .map(e => e.getAttribute('data-message-id'));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  // Test ID: EVICT-004 — one known neighbour is still enough to place it, and
  // the direction matters in both senses. Keys are distance from the scroller
  // BOTTOM, so a larger key sorts earlier; the first version of this fix had
  // both one-sided cases inverted and put the rescued message at the wrong end.
  test('a rescued message with only a following neighbour is ordered before it', () => {
    const el = scroller(['a', 'c']);
    setMessageScroller(el);
    captureRenderedMessages();

    captureDetachedMessages([detached('b')], {
      type: 'childList',
      previousSibling: null,
      nextSibling: el.querySelector('[data-message-id="c"]')
    });

    const order = getCapturedMessageEls()
      .map(e => e.getAttribute('data-message-id'));
    expect(order).toEqual(['a', 'b', 'c']);
    expect(getCaptureOrderStats().withoutOrderKey).toBe(0);
  });

  // Test ID: EVICT-004b — and the mirror case, which is what catches the sign.
  test('a rescued message with only a preceding neighbour is ordered after it', () => {
    const el = scroller(['a', 'c']);
    setMessageScroller(el);
    captureRenderedMessages();

    captureDetachedMessages([detached('b')], {
      type: 'childList',
      previousSibling: el.querySelector('[data-message-id="a"]'),
      nextSibling: null
    });

    const order = getCapturedMessageEls()
      .map(e => e.getAttribute('data-message-id'));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  // Test ID: EVICT-005 — with no neighbour at all it is kept anyway. A message
  // that cannot be positioned must still not go missing, and the existing
  // withoutOrderKey counter is what reports the degraded ordering.
  test('a rescued message with no cached neighbour is kept, not dropped', () => {
    const el = scroller([]);
    setMessageScroller(el);

    captureDetachedMessages([detached('lonely')], {
      type: 'childList', previousSibling: null, nextSibling: null
    });

    expect(getCaptureOrderStats().captured).toBe(1);
    expect(getCaptureOrderStats().withoutOrderKey).toBe(1);
  });

  // Test ID: EVICT-006 — a node may CONTAIN messages rather than be one.
  test('messages inside a removed subtree are rescued', () => {
    const el = scroller(['a']);
    setMessageScroller(el);
    captureRenderedMessages();

    const wrapper = document.createElement('div');
    wrapper.appendChild(detached('x'));
    wrapper.appendChild(detached('y'));
    captureDetachedMessages([wrapper], { type: 'childList', previousSibling: null, nextSibling: null });

    expect(getCaptureOrderStats().captured).toBe(3);
    expect(getRescuedCount()).toBe(2);
  });

  // Test ID: EVICT-007 — never a duplicate. The same message arrives via the
  // live sweep and via a record on almost every batch.
  test('a message already captured is not duplicated', () => {
    const el = scroller(['a']);
    setMessageScroller(el);
    captureRenderedMessages();

    captureDetachedMessages([el.querySelector('[data-message-id="a"]')],
      { type: 'childList', previousSibling: null, nextSibling: null });

    expect(getCaptureOrderStats().captured).toBe(1);
    expect(getRescuedCount()).toBe(0);
  });

  // Test ID: EVICT-008 — empty and malformed input must not take the scroll
  // down. Images fail open; a scroll that throws loses the whole conversation.
  test('empty or junk input is harmless', () => {
    scroller(['a']);
    expect(captureDetachedMessages(null, null)).toBe(0);
    expect(captureDetachedMessages([], {})).toBe(0);
    expect(captureDetachedMessages([document.createTextNode('hi')], {})).toBe(0);
  });
});

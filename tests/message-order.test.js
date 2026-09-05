/**
 * Conversation ordering under virtualization (#264).
 *
 * On a real 155-message conversation every message was captured and the
 * transcript still opened on the wrong one, because the sort key —
 * data-testid="conversation-turn-N" — is numbered relative to the rendered
 * window and took only 14 distinct values. These tests reconstruct a known
 * sequence from overlapping windows, which is the only ordering signal
 * virtualization actually leaves behind.
 */

const {
  captureRenderedMessages,
  getCapturedMessageEls,
  resetMessageCache
} = require('../extensions/src/content.js');

const { SELECTORS } = require('../extensions/src/selectors-chatgpt.js');
global.SELECTORS = SELECTORS;

/** Render one virtualized window: the given ids, in conversation order. */
function renderWindow(ids) {
  document.body.innerHTML = ids.map((id, i) => `
    <div data-testid="conversation-turn-${i + 1}">
      <div data-message-author-role="${i % 2 ? 'assistant' : 'user'}" data-message-id="${id}">${id}</div>
    </div>`).join('');
}

const captured = () =>
  getCapturedMessageEls().map(el => el.getAttribute('data-message-id'));

beforeEach(() => {
  resetMessageCache();
  document.body.innerHTML = '';
});

describe('window stitching (#264)', () => {
  test('reconstructs the conversation from windows seen newest-first', () => {
    // The real motion: start at the bottom, scroll back, each window overlapping
    // the last. Note every window renumbers conversation-turn from 1.
    renderWindow(['m7', 'm8', 'm9']);   captureRenderedMessages();
    renderWindow(['m4', 'm5', 'm6', 'm7']); captureRenderedMessages();
    renderWindow(['m1', 'm2', 'm3', 'm4']); captureRenderedMessages();

    expect(captured()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });

  test('works when consecutive windows share only one message', () => {
    renderWindow(['m5', 'm6']); captureRenderedMessages();
    renderWindow(['m3', 'm4', 'm5']); captureRenderedMessages();
    renderWindow(['m1', 'm2', 'm3']); captureRenderedMessages();

    expect(captured()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  });

  test('is unaffected by conversation-turn numbering restarting each window', () => {
    // Every window here labels its first message conversation-turn-1. Ordering
    // by that testid would put m1, m4 and m7 all in the same bucket.
    renderWindow(['m7', 'm8', 'm9']); captureRenderedMessages();
    renderWindow(['m4', 'm5', 'm6', 'm7']); captureRenderedMessages();
    renderWindow(['m1', 'm2', 'm3', 'm4']); captureRenderedMessages();

    const order = captured();
    expect(order[0]).toBe('m1');
    expect(order[order.length - 1]).toBe('m9');
  });

  test('a re-rendered window does not duplicate or reorder anything', () => {
    renderWindow(['m3', 'm4', 'm5']); captureRenderedMessages();
    renderWindow(['m1', 'm2', 'm3']); captureRenderedMessages();
    renderWindow(['m3', 'm4', 'm5']); captureRenderedMessages();   // scrolled back down

    expect(captured()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  test('handles forward scrolling too', () => {
    renderWindow(['m1', 'm2', 'm3']); captureRenderedMessages();
    renderWindow(['m3', 'm4', 'm5']); captureRenderedMessages();
    renderWindow(['m5', 'm6', 'm7']); captureRenderedMessages();

    expect(captured()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  });

  test('an island with no overlap is kept, not dropped', () => {
    renderWindow(['m1', 'm2']); captureRenderedMessages();
    renderWindow(['zz1', 'zz2']); captureRenderedMessages();   // no shared id

    const order = captured();
    expect(order).toHaveLength(4);
    for (const id of ['m1', 'm2', 'zz1', 'zz2']) expect(order).toContain(id);
  });

  test('every captured message survives eviction', () => {
    renderWindow(['m4', 'm5', 'm6']); captureRenderedMessages();
    renderWindow(['m1', 'm2', 'm3', 'm4']); captureRenderedMessages();

    // Only the last window is in the DOM.
    expect(document.querySelectorAll(SELECTORS.allMessages)).toHaveLength(4);
    expect(captured()).toHaveLength(6);
  });
});

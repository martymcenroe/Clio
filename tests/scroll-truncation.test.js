/**
 * A capture that stopped short must not look like a complete one (#278).
 *
 * Two exports of the same ChatGPT conversation, seven minutes apart:
 *
 *   05:25  233 messages  106 scroll attempts
 *   05:32   52 messages    2 scroll attempts
 *
 * Both reported the same success shape. A consumer reading the 52-message file
 * had no way to know it was a fragment; it was only caught by holding three
 * captures of the same conversationId and diffing them.
 *
 * The defect: scrollToLoadAllMessages() treated "the scroller did not move" as
 * equivalent to "the scroller reached the top". Two quiet rounds at a non-zero
 * offset returned success with no warning.
 *
 * REPRODUCED before it was fixed. Against the previous build, TRUNC-001 printed
 *   {"success":true,"messagesLoaded":2,"scrollAttempts":2}
 * for a scroller pinned at 3000 of 50000 — scrollAttempts 2, success true, no
 * warning: the 52-message export's shape exactly.
 */

const {
  scrollToLoadAllMessages,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS } = require('../extensions/src/selectors.js');
global.SELECTORS = SELECTORS;

const FAST = {
  scrollStep: 100, scrollDelay: 10, loadingAppearDelay: 5, mutationTimeout: 20,
  maxScrollAttempts: 40, loadingCheckInterval: 10, maxLoadingWait: 100,
  progressUpdateInterval: 2, stuckRetries: 3, topSettleRounds: 2
};

function conversationDom() {
  document.body.innerHTML = `
    <div id="chat-history" style="overflow-y: auto; height: 200px;">
      <div data-conversation-id="conv-278">
        <div data-message-author-role="user">only the tail of the conversation</div>
        <div data-message-author-role="model">is rendered here</div>
      </div>
    </div>`;
  return document.getElementById('chat-history');
}

/** A scroller pinned at a non-zero offset: assignments to scrollTop do nothing. */
function stuckScroller(pinnedAt = 3000) {
  const el = conversationDom();
  Object.defineProperty(el, 'scrollTop', {
    get: () => pinnedAt,
    set: () => { /* the scroll never takes effect */ },
    configurable: true
  });
  Object.defineProperty(el, 'scrollHeight', { get: () => 50000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  return el;
}

/** A scroller that walks up to the top the way a healthy page does. */
function walkingScroller(startAt = 400) {
  const el = conversationDom();
  let top = startAt;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v) => { top = Math.max(0, v); },
    configurable: true
  });
  Object.defineProperty(el, 'scrollHeight', { get: () => 5000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  return el;
}

describe('scrollToLoadAllMessages distinguishes stuck from finished', () => {
  beforeEach(() => { setScrollConfig(FAST); });
  afterEach(() => { resetScrollConfig(); });

  // Test ID: TRUNC-001 — the reproduction. This is the 52-message capture.
  test('a scroller stuck below the top reports that it did not reach the top', async () => {
    stuckScroller(3000);

    const result = await scrollToLoadAllMessages();

    expect(result.reachedTop).toBe(false);
    expect(result.terminationReason).toBe('stuck');
    expect(result.finalScrollTop).toBe(3000);
    expect(result.warning).toMatch(/from the top|missing/i);
  });

  // Test ID: TRUNC-002 — and it stops guessing after two rounds. Two was the
  // old limit and it is what produced a 52-message capture of a 233-message
  // conversation: a virtualized list can re-anchor the scroller while a batch
  // loads, and quitting into that window looks exactly like success.
  test('a stuck scroller is retried more than twice before giving up', async () => {
    stuckScroller(3000);

    const result = await scrollToLoadAllMessages();

    expect(result.scrollAttempts).toBeGreaterThan(2);
    expect(result.scrollAttempts).toBeGreaterThanOrEqual(FAST.stuckRetries);
  });

  // Test ID: TRUNC-003 — the check must not fire on a healthy walk, or it is
  // just the old always-true flag wearing a new name.
  test('a scroller that reaches the top reports a completed walk', async () => {
    walkingScroller(400);

    const result = await scrollToLoadAllMessages();

    expect(result.reachedTop).toBe(true);
    expect(result.terminationReason).toBe('reached-top');
    expect(result.warning).toBeUndefined();
  });

  // Test ID: TRUNC-004 — a conversation short enough to need no scrolling has
  // genuinely reached its beginning.
  test('a conversation already at the top is complete, not stuck', async () => {
    walkingScroller(0);

    const result = await scrollToLoadAllMessages();

    expect(result.reachedTop).toBe(true);
    expect(result.terminationReason).toBe('reached-top');
  });

  // Test ID: TRUNC-005 — a real browser can leave a fractional offset after a
  // smooth scroll; sub-pixel residue is the top, not a truncation.
  test('a sub-pixel offset counts as the top', async () => {
    const el = conversationDom();
    Object.defineProperty(el, 'scrollTop', {
      get: () => 0.5, set: () => {}, configurable: true
    });
    Object.defineProperty(el, 'scrollHeight', { get: () => 5000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });

    const result = await scrollToLoadAllMessages();

    expect(result.reachedTop).toBe(true);
  });

  // Test ID: TRUNC-007 — the live finding, and the reason topSettleRounds is
  // not 2.
  //
  // Measured against the real site 2026-09-06: scrolling a real conversation to
  // offset 0 and waiting, the scroller reported scrollTop 0 with an unchanged
  // scrollHeight and message count for up to FOUR consecutive rounds, and then
  // prepended more history. Over 25 rounds scrollHeight went 14,795 -> 115,437
  // and was still climbing.
  //
  // So offset zero is the top of the LOADED WINDOW, not the beginning of the
  // conversation. A build that stops at the first quiet round there reports
  // reachedTop: true on a fragment — the #278 defect wearing a better name.
  test('a conversation still prepending history has not reached the top', async () => {
    const el = conversationDom();
    Object.defineProperty(el, 'scrollTop', {
      get: () => 0, set: () => {}, configurable: true
    });
    Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });

    // Quiet for two rounds, then a batch lands — exactly the shape measured.
    let height = 5000;
    let reads = 0;
    Object.defineProperty(el, 'scrollHeight', {
      get: () => {
        reads++;
        if (reads === 4) height = 40000;   // history arrives after a quiet spell
        return height;
      },
      configurable: true
    });

    const result = await scrollToLoadAllMessages();

    // It must have kept going past the quiet spell rather than stopping in it.
    expect(result.scrollAttempts).toBeGreaterThan(FAST.topSettleRounds);
    // And when it does finish, it is because growth genuinely stopped.
    expect(result.reachedTop).toBe(true);
    expect(result.finalScrollHeight).toBe(40000);
  });

  // Test ID: TRUNC-006
  test('hitting the attempt ceiling is reported as its own reason', async () => {
    const el = conversationDom();
    let top = 9000;
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      // Creeps upward forever: never stuck, never at the top.
      set: () => { top = Math.max(1, top - 1); },
      configurable: true
    });
    Object.defineProperty(el, 'scrollHeight', { get: () => 50000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });

    const result = await scrollToLoadAllMessages();

    expect(result.reachedTop).toBe(false);
    expect(result.terminationReason).toBe('max-attempts');
    expect(result.scrollAttempts).toBe(FAST.maxScrollAttempts);
  });
});

describe('the export says so on its own (#278 acceptance)', () => {
  beforeEach(() => { setScrollConfig(FAST); });
  afterEach(() => { resetScrollConfig(); });

  // Test ID: TRUNC-010 — the acceptance criterion verbatim: distinguishable by
  // reading conversation.json alone, with no second capture and no oracle.
  test('a truncated capture is marked incomplete in its own metadata', async () => {
    stuckScroller(3000);

    const md = (await extractConversation()).data.metadata;

    expect(md.contentComplete).toBe(false);
    expect(md.partialSuccess).toBe(true);
    expect(md.incompleteReasons.join(' ')).toMatch(/top of the conversation/i);
    expect(md.scrollInfo.reachedTop).toBe(false);
    expect(md.scrollInfo.terminationReason).toBe('stuck');
    expect(md.scrollInfo.finalScrollTop).toBe(3000);
  });

  // Test ID: TRUNC-011 — and a complete capture still reads complete, so this
  // is a signal rather than a permanent warning.
  test('a complete capture is marked complete', async () => {
    walkingScroller(400);

    const md = (await extractConversation()).data.metadata;

    expect(md.contentComplete).toBe(true);
    expect(md.incompleteReasons).toEqual([]);
    expect(md.scrollInfo.reachedTop).toBe(true);
    expect(md.scrollInfo.terminationReason).toBe('reached-top');
  });
});

describe('the popup says so at capture time', () => {
  const { showIncompleteWarning } = require('../extensions/src/popup.js');

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="incompleteWarning" style="display: none;">
        <span id="incompleteWarningText"></span>
      </div>`;
  });

  // Test ID: TRUNC-020
  test('an incomplete capture raises the row and states the reason', () => {
    showIncompleteWarning({
      contentComplete: false,
      incompleteReasons: ['Scrolling did not reach the top of the conversation, so earlier messages are missing.']
    });

    expect(document.getElementById('incompleteWarning').style.display).toBe('block');
    expect(document.getElementById('incompleteWarningText').textContent)
      .toMatch(/INCOMPLETE.*top of the conversation/i);
  });

  // Test ID: TRUNC-021
  test('a complete capture raises nothing', () => {
    showIncompleteWarning({ contentComplete: true, incompleteReasons: [] });

    expect(document.getElementById('incompleteWarning').style.display).toBe('none');
  });

  // Test ID: TRUNC-022 — a result saved by a pre-#278 build has no
  // contentComplete. Treating "missing" as "incomplete" would flag every
  // capture, which is the unreadable signal this work exists to remove.
  test('a pre-278 result is not flagged', () => {
    showIncompleteWarning({ messageCount: 52 });

    expect(document.getElementById('incompleteWarning').style.display).toBe('none');
  });
});

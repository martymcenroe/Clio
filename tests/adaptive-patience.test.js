/**
 * The patience at the top scales with how slow this session has actually been
 * (#300).
 *
 * The old rule was a constant: six quiet rounds at offset zero, about 18
 * seconds. Measured across three instrumented live captures, the longest gap
 * that STILL produced content was 27.6s, 31.4s and 21.5s — every run could
 * out-wait the loop. One of them stopped 110,000px short and lost 41
 * consecutive messages while reporting `reachedTop: true`.
 *
 * Raising the constant would just be a different bet: the maximum moved by ten
 * seconds across three runs an hour apart on one machine and one conversation.
 * So the quiet stretch must also exceed a multiple of the longest gap observed
 * during the walk itself.
 */

const {
  scrollToLoadAllMessages,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS } = require('../extensions/src/selectors.js');
global.SELECTORS = SELECTORS;

const FAST = {
  scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 2, mutationTimeout: 5,
  maxScrollAttempts: 300, loadingCheckInterval: 5, maxLoadingWait: 50,
  progressUpdateInterval: 50, stuckRetries: 3, topSettleRounds: 2,
  patienceFactor: 2, minTopWaitMs: 0, maxTopWaitMs: 180000
};

/**
 * A conversation scroller.
 *
 * `startAt` lets the walk spend real time scrolling down to the top, which is
 * what makes a long arrival gap observable at all: while the scroller is still
 * moving the loop is not "quiet at top", so it stays alive long enough for a
 * slow batch to land. Pinning it at zero from the start reproduces the very bug
 * under test — the walk finishes before the slow content arrives — so the
 * fixture could never demonstrate the fix.
 *
 * `growAfterMs` grows scrollHeight once, modelling the single slow batch the
 * live census measured at 21-31 seconds.
 */
function conversationScroller({ startAt = 0, growAfterMs = 0 } = {}) {
  document.body.innerHTML = `
    <div id="sc" style="overflow-y: auto; height: 200px;">
      <div data-conversation-id="c1">
        <div data-message-author-role="user">a</div>
        <div data-message-author-role="model">b</div>
      </div>
    </div>`;
  const el = document.getElementById('sc');
  const t0 = Date.now();
  let top = startAt;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v) => { top = Math.max(0, v); },
    configurable: true
  });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  Object.defineProperty(el, 'scrollHeight', {
    get: () => (growAfterMs && Date.now() - t0 >= growAfterMs ? 9000 : 5000),
    configurable: true
  });
  return el;
}

describe('patience at the top scales with observed arrival latency', () => {
  beforeEach(() => { setScrollConfig(FAST); });
  afterEach(() => { resetScrollConfig(); });

  // Test ID: PATIENCE-001 — the control. A walk that never waited for anything
  // has no observed gap, so the time condition is vacuous and the round count
  // decides, exactly as before. This is what keeps short conversations and the
  // rest of the offline suite at their current speed.
  test('a walk that never saw a delay finishes promptly', async () => {
    conversationScroller();

    const started = Date.now();
    const r = await scrollToLoadAllMessages();
    const elapsed = Date.now() - started;

    expect(r.reachedTop).toBe(true);
    // The opening sweep counts as one arrival, so the observed gap is the time
    // to first content rather than zero — small, and the patience with it.
    expect(r.longestArrivalGapMs).toBeLessThan(200);
    expect(r.requiredQuietMs).toBeLessThan(400);
    expect(elapsed).toBeLessThan(900);
  });

  // Test ID: PATIENCE-002 — the fix. One slow batch teaches the walk that this
  // session stalls, and it then refuses to call the top until it has been quiet
  // for patienceFactor times that stall.
  test('a slow batch makes the walk wait proportionally longer', async () => {
    conversationScroller({ startAt: 4000, growAfterMs: 400 });

    const started = Date.now();
    const r = await scrollToLoadAllMessages();
    const elapsed = Date.now() - started;

    expect(r.reachedTop).toBe(true);
    // It saw the stall...
    expect(r.longestArrivalGapMs).toBeGreaterThanOrEqual(350);
    // ...and demanded proportionally more silence than the round count alone.
    expect(r.requiredQuietMs).toBeGreaterThanOrEqual(r.longestArrivalGapMs * 2 - 1);
    expect(r.quietForMs).toBeGreaterThanOrEqual(r.requiredQuietMs);
    // Which takes real time: the growth at 400ms plus 2x that in silence.
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });

  // Test ID: PATIENCE-003 — the ceiling, so a pathological session cannot wait
  // forever. maxScrollAttempts already bounds the walk; this bounds the wait.
  test('the required quiet is capped', async () => {
    setScrollConfig({ ...FAST, maxTopWaitMs: 50 });
    conversationScroller({ startAt: 4000, growAfterMs: 400 });

    const r = await scrollToLoadAllMessages();

    expect(r.requiredQuietMs).toBeLessThanOrEqual(50);
    expect(r.reachedTop).toBe(true);
  });

  // Test ID: PATIENCE-004 — the evidence travels with the verdict, so a capture
  // that stopped short can be argued about from the file rather than re-run.
  test('the observed gap and the patience applied are both reported', async () => {
    conversationScroller({ startAt: 2000, growAfterMs: 200 });

    const r = await scrollToLoadAllMessages();

    expect(typeof r.longestArrivalGapMs).toBe('number');
    expect(typeof r.requiredQuietMs).toBe('number');
    expect(typeof r.quietForMs).toBe('number');
  });
});

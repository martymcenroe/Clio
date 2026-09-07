/**
 * Every message carries its own id (#294).
 *
 * The id was already in hand while turns were built — read to attach files,
 * used as the cache key for the whole scroll — and then discarded, leaving
 * `index` as the only handle on a message. `index` is a position within one
 * capture, so it changes whenever the capture does.
 *
 * The cost was concrete: the acceptance test on #278 is "a correct extraction is
 * a superset of the three existing captures", and without ids it had to be
 * attempted on message text. Two comparators gave two different answers — 130
 * missing on exact text, 44 on a normalised prefix — because the harvester takes
 * `el.innerText` while the extension runs `extractTextContent()`. Neither was
 * authoritative, on the question that decides whether the tool works.
 */

const {
  extractTurns,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');
const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

const FAST = {
  scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 2, mutationTimeout: 10,
  maxScrollAttempts: 10, loadingCheckInterval: 5, maxLoadingWait: 50,
  progressUpdateInterval: 5, stuckRetries: 2, topSettleRounds: 2
};

function chatgptDom() {
  document.body.innerHTML = `
    <div id="root" style="overflow-y: auto; height: 200px;">
      <main>
        <div data-message-author-role="user" data-message-id="msg-u1">
          <div class="whitespace-pre-wrap">first question</div>
        </div>
        <div data-message-author-role="assistant" data-message-id="msg-a1">
          <div class="markdown">first answer</div>
        </div>
      </main>
    </div>`;
  const el = document.getElementById('root');
  Object.defineProperty(el, 'scrollHeight', { get: () => 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
  return el;
}

describe('messages carry their own identity', () => {
  beforeEach(() => { setScrollConfig(FAST); });
  afterEach(() => { resetScrollConfig(); });

  // Test ID: ID-001
  test('a ChatGPT export carries data-message-id on every message', async () => {
    global.SELECTORS = CHATGPT;
    chatgptDom();

    const data = (await extractConversation()).data;

    expect(data.messages.map(m => m.id)).toEqual(['msg-u1', 'msg-a1']);
  });

  // Test ID: ID-002 — present-and-null, never absent. A consumer comparing two
  // captures has to tell "this site has no message identity" from "this build
  // predates the field", and an absent key cannot say which.
  test('a site with no message identity still carries the key, as null', async () => {
    global.SELECTORS = GEMINI;
    document.body.innerHTML = `
      <div id="chat-history" style="overflow-y: auto; height: 200px;">
        <div data-conversation-id="c1">
          <div data-message-author-role="user">hello</div>
          <div data-message-author-role="model">hi</div>
        </div>
      </div>`;
    const el = document.getElementById('chat-history');
    Object.defineProperty(el, 'scrollHeight', { get: () => 2000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => 200, configurable: true });
    Object.defineProperty(el, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });

    const data = (await extractConversation()).data;

    expect(data.messages.length).toBeGreaterThan(0);
    for (const m of data.messages) {
      expect(Object.prototype.hasOwnProperty.call(m, 'id')).toBe(true);
      expect(m.id).toBeNull();
    }
  });

  // Test ID: ID-003 — the property that makes the acceptance test possible:
  // identity must survive re-indexing, which `index` by definition does not.
  test('ids are stable while index is not', async () => {
    global.SELECTORS = CHATGPT;
    chatgptDom();
    const first = (await extractConversation()).data.messages;

    // A newer capture of the same conversation, with an older message now
    // loaded above: every index shifts, every id does not.
    document.body.innerHTML = `
      <div id="root2" style="overflow-y: auto; height: 200px;">
        <main>
          <div data-message-author-role="user" data-message-id="msg-u0">
            <div class="whitespace-pre-wrap">earlier question</div>
          </div>
          <div data-message-author-role="user" data-message-id="msg-u1">
            <div class="whitespace-pre-wrap">first question</div>
          </div>
          <div data-message-author-role="assistant" data-message-id="msg-a1">
            <div class="markdown">first answer</div>
          </div>
        </main>
      </div>`;
    const el2 = document.getElementById('root2');
    Object.defineProperty(el2, 'scrollHeight', { get: () => 2000, configurable: true });
    Object.defineProperty(el2, 'clientHeight', { get: () => 200, configurable: true });
    Object.defineProperty(el2, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
    const second = (await extractConversation()).data.messages;

    const byIdFirst = new Map(first.map(m => [m.id, m.index]));
    const byIdSecond = new Map(second.map(m => [m.id, m.index]));

    // Same message, different position.
    expect(byIdFirst.get('msg-u1')).toBe(0);
    expect(byIdSecond.get('msg-u1')).toBe(1);

    // And the superset check the acceptance test needs is now a set difference.
    const missing = [...byIdFirst.keys()].filter(id => !byIdSecond.has(id));
    expect(missing).toEqual([]);
  });
});

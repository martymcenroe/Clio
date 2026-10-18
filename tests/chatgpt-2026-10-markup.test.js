/**
 * Regression tests for #399: ChatGPT's 2026-10 thread markup.
 *
 * On 2026-10-17 every ChatGPT extraction failed before it began with
 * "ChatGPT UI may have changed. Missing selectors: messages." ChatGPT had
 * replaced the thread markup wholesale, and every test in the suite still
 * passed, because every ChatGPT fixture still carried the 2026-05 markup.
 *
 * The fixture here was built from the live page, not from the source: its
 * ancestor chains, attributes and both code-block shapes are what
 * tools/chatgpt/probe-turns.js reported. Its text is invented.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const {
  validateSelectors,
  countMessages,
  extractTurnsChatGPT,
  messageIdOf,
  chatgptRoleOf,
  isAgentReply,
  queryMessages,
  turnKeyOf,
  captureRenderedMessages,
  captureDetachedMessages,
  getCapturedMessageEls,
  getCaptureOrderStats,
  getRefreshedCount,
  countReasoningAffordances,
  offersReasoning,
  layoutRectOf,
  measureFromBottom,
  resetMessageCache,
  findScrollContainer,
  detectCodeLanguage,
  codeBlockRootOf
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT_SELECTORS } = require('../extensions/src/selectors-chatgpt.js');
const { SELECTORS: GEMINI_SELECTORS } = require('../extensions/src/selectors.js');

// The message selectors v1.9.1 shipped, verbatim: what was live when the
// operator's extraction failed.
const SELECTORS_1_9_1 = {
  ...CHATGPT_SELECTORS,
  userMessage: '[data-message-author-role="user"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  allMessages: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
  replyMarker: undefined // 1.9.1 had no notion of a unit-less reply
};

const IDS = [
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '44444444-4444-4444-8444-444444444444',
  // Exchange 3's reply has no unit and no id of its own: it is named for its
  // exchange, whose key is the opening user message's id.
  '44444444-4444-4444-8444-444444444444:reply',
  '55555555-5555-4555-8555-555555555555',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
];
const ROLES = ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant'];

function use(selectors) {
  global.SELECTORS = selectors;
  if (typeof window !== 'undefined') window.SELECTORS = selectors;
}

beforeEach(() => {
  use(CHATGPT_SELECTORS);
  resetMessageCache();
  document.body.innerHTML = loadFixture('chatgpt-conversation-2026-10.html');
});

afterEach(() => {
  resetMessageCache();
  use(GEMINI_SELECTORS);
});

describe('the defect (#399)', () => {
  test('the 1.9.1 selectors report "messages" missing on the 2026-10 markup', () => {
    use(SELECTORS_1_9_1);
    expect(validateSelectors()).toEqual({ valid: false, missing: ['messages'] });
  });

  test('the fixture carries none of the attributes 1.9.1 relied on', () => {
    expect(document.querySelectorAll(
      '[data-message-author-role], [data-message-id], [data-turn-id], .markdown'
    ).length).toBe(0);
  });
});

describe('validation and counting', () => {
  test('validateSelectors passes', () => {
    expect(validateSelectors()).toEqual({ valid: true, missing: [] });
  });

  test('countMessages counts each message once, both roles', () => {
    expect(countMessages()).toBe(8);
  });

  test('message elements never nest, so nothing is captured twice', () => {
    const els = queryMessages(document);
    expect(els).toHaveLength(8);
    for (const el of els) {
      expect(queryMessages(el)).toEqual([]);
    }
  });

  test('the selectors alone miss the unit-less reply; queryMessages adds it in document order', () => {
    expect(document.querySelectorAll(CHATGPT_SELECTORS.allMessages)).toHaveLength(7);
    expect(queryMessages(document).map(isAgentReply).indexOf(true)).toBe(5);
  });
});

describe('message identity and role', () => {
  test('role comes from the search-unit key suffix, or from being a unit-less reply', () => {
    expect(queryMessages(document).map(chatgptRoleOf)).toEqual(ROLES);
  });

  test('only the unit-less reply is an agent reply — not the block that holds a unit', () => {
    expect(queryMessages(document).map(isAgentReply))
      .toEqual([false, false, false, false, false, true, false, false]);
    const unitBlock = document.querySelector('[data-chatgpt-search-unit-key="fallback-turn-3:2:assistant"]').parentElement;
    expect(isAgentReply(unitBlock)).toBe(false);
  });

  test('id is the first token of data-chatgpt-search-message-ids, or the exchange key for a unit-less reply', () => {
    const els = queryMessages(document);
    // The assistant lists its own id twice; it must come out once, unchanged.
    expect(els.map(messageIdOf)).toEqual(IDS);
  });

  test('the 2026-05 attributes still win where present', () => {
    document.body.innerHTML =
      '<div data-message-author-role="assistant" data-message-id="m-1" ' +
      'data-chatgpt-search-unit-key="k:0:user" data-chatgpt-search-message-ids="other"></div>';
    const el = document.body.firstElementChild;
    expect(messageIdOf(el)).toBe('m-1');
    expect(chatgptRoleOf(el)).toBe('assistant');
  });

  test('an element with no identity yields null rather than a guess', () => {
    document.body.innerHTML = '<div data-chatgpt-search-message-ids="   "></div>';
    expect(messageIdOf(document.body.firstElementChild)).toBeNull();
    expect(chatgptRoleOf(document.body.firstElementChild)).toBeNull();
  });
});

describe('capture during the scroll', () => {
  test('every message is captured — an id-less message is skipped silently', () => {
    expect(captureRenderedMessages()).toBe(8);
    expect(getCaptureOrderStats().captured).toBe(8);
  });

  test('a cached clone carries its id and exchange, which a detached node cannot look up', () => {
    captureRenderedMessages();
    const reply = getCapturedMessageEls().find(el => isAgentReply(el));
    expect(reply.parentElement).toBeNull();
    expect(messageIdOf(reply)).toBe(IDS[5]);
    expect(turnKeyOf(reply)).toBe('44444444-4444-4444-8444-444444444444');
  });
});

describe('a message mounted before its text renders (#399)', () => {
  // Live, 2026-10-17: the assistant unit arrives with its id and an EMPTY
  // markdown root, and the text fills in afterwards. 24 of 75 assistant
  // messages in one capture were kept in that state and then dropped as blank.
  const ASSISTANT = '[data-chatgpt-search-unit-key="fallback-turn-0:2:assistant"]';
  let held;

  function hollowOut() {
    const root = document.querySelector(`${ASSISTANT} [data-markdown-text-style]`);
    held = Array.from(root.childNodes);
    root.replaceChildren();
  }
  function fillIn() {
    document.querySelector(`${ASSISTANT} [data-markdown-text-style]`).replaceChildren(...held);
  }

  test('the shell is re-captured once its text arrives, and keeps its place', async () => {
    hollowOut();
    captureRenderedMessages();
    const before = getCapturedMessageEls().map(messageIdOf);

    fillIn();
    expect(captureRenderedMessages()).toBe(0); // nothing NEW
    expect(getRefreshedCount()).toBe(1);
    expect(getCapturedMessageEls().map(messageIdOf)).toEqual(before);

    const turns = await extractTurnsChatGPT();
    expect(turns[1].content).toBe(
      'Sort the long listing by size:\n```bash\nls -lS\n```\nLargest files come first.'
    );
  });

  test('a shell that never fills exports blank — the state the refresh exists to leave', async () => {
    // What 1.9.1's cache froze: hollow at first sight, never revisited.
    hollowOut();
    captureRenderedMessages();
    const turns = await extractTurnsChatGPT();
    expect(turns[1].content).toBe('');
  });

  test('an evicted node carrying the text refreshes the shell too', () => {
    hollowOut();
    captureRenderedMessages();

    const full = document.querySelector(ASSISTANT).cloneNode(true);
    full.querySelector('[data-markdown-text-style]').replaceChildren(...held.map(n => n.cloneNode(true)));
    captureDetachedMessages([full], null);

    expect(getRefreshedCount()).toBe(1);
    const cached = getCapturedMessageEls().find(el => messageIdOf(el) === IDS[1]);
    expect(cached.textContent).toContain('ls -lS');
  });

  test('an image-only user message is re-captured when its image arrives — it adds no text', async () => {
    // Observed live: the unit mounts with its attachment row and button, then
    // the <img> appears. A text-length test can never see that happen.
    document.body.innerHTML = `
      <main><div data-app-action-timeline-scroll>
        <div data-turn-key="33333333-3333-4333-8333-333333333333">
          <div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="33333333-3333-4333-8333-333333333333" class="group/user-message flex flex-col items-end">
            <div class="flex flex-wrap items-end justify-end">
              <div role="button" aria-label="Open image" class="size-20 cursor-interaction rounded-lg border"></div>
            </div>
            <div data-content-search-unit-key="fallback-turn-0:0:user" class="w-full"></div>
          </div>
        </div>
      </div></main>`;
    captureRenderedMessages();

    const img = document.createElement('img');
    img.setAttribute('alt', 'Uploaded image');
    img.setAttribute('src', 'blob:https://chatgpt.com/00000000-0000-4000-8000-000000000000');
    img.className = 'h-full w-full rounded-md object-cover';
    document.querySelector('[role="button"]').appendChild(img);
    captureRenderedMessages();

    expect(getRefreshedCount()).toBe(1);
    const turns = await extractTurnsChatGPT();
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].attachments.map(a => a.type)).toEqual(['image']);
  });

  test('a copy with less text never replaces a fuller one', () => {
    captureRenderedMessages();
    hollowOut();
    captureRenderedMessages();

    expect(getRefreshedCount()).toBe(0);
    const cached = getCapturedMessageEls().find(el => messageIdOf(el) === IDS[1]);
    expect(cached.textContent).toContain('ls -lS');
  });
});

describe('extracted turns', () => {
  test('roles, ids and text, in order', async () => {
    captureRenderedMessages();
    const turns = await extractTurnsChatGPT();

    expect(turns.map(t => t.role)).toEqual(ROLES);
    expect(turns.map(t => t.id)).toEqual(IDS);
    expect(turns[0].content).toBe('How do I list files by size?');
    expect(turns[2].content).toBe('And in Python?');
    expect(turns[4].content).toBe('Check the config file for errors.');
    expect(turns[6].content).toBe('Fix it.');
  });

  test('a reply with no unit is extracted: every text root, in order, without the activity line', async () => {
    // 12 of 79 replies in one live conversation had this shape and were
    // invisible to 1.9.1's successor selectors.
    const turns = await extractTurnsChatGPT();
    expect(turns[5].content).toBe('Opening the config now.\n\nIt parses, but timeout is set twice.');
  });

  test('a "Worked for" line before a unit is not a turn of its own', async () => {
    const turns = await extractTurnsChatGPT();
    expect(turns).toHaveLength(8);
    expect(turns[7].content).toBe('Removed the second timeout line.');
    expect(turns.some(t => /Worked for/.test(t.content))).toBe(false);
  });

  test('the block holding only a reasoning line is not a message; its exchange\'s unit is', () => {
    // Live, #400: in 37 of 37 exchanges with both, the marker's block held only
    // "Worked for …" and the unit sat in the next block.
    const workedBlock = document.querySelector('[data-turn-key="55555555-5555-4555-8555-555555555555"] [data-chatgpt-agent-turn-start]').parentElement;
    expect(isAgentReply(workedBlock)).toBe(false);

    captureRenderedMessages();
    expect(getCapturedMessageEls().map(messageIdOf)).not.toContain('55555555-5555-4555-8555-555555555555:reply');
    expect(getCaptureOrderStats().captured).toBe(8);
  });

  test('a marker block carrying reply text is kept even when its exchange also has a unit', async () => {
    // Never observed, and the reason the rule is "keep" rather than "replace":
    // a reply exported twice is visible, a reply dropped is not.
    const workedBlock = document.querySelector('[data-turn-key="55555555-5555-4555-8555-555555555555"] [data-chatgpt-agent-turn-start]').parentElement;
    const text = document.createElement('div');
    text.innerHTML = '<div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary" class="MarkdownRoot-rZKhxa"><p>Looking at the file first.</p></div>';
    workedBlock.appendChild(text);

    captureRenderedMessages();
    const turns = await extractTurnsChatGPT();
    expect(turns.slice(7).map(t => [t.id, t.content])).toEqual([
      ['55555555-5555-4555-8555-555555555555:reply', 'Looking at the file first.'],
      ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Removed the second timeout line.']
    ]);
  });

  test('a marker block with nothing but an activity line is not a message at all', async () => {
    // Live: a cancelled reply whose block held nothing but "Stopped thinking".
    const reply = document.querySelector('[data-turn-key="44444444-4444-4444-8444-444444444444"] [data-chatgpt-agent-turn-start]').parentElement;
    reply.querySelectorAll('[data-markdown-text-tone]').forEach(root => {
      if (!root.closest('[class*="activity-header"]')) root.remove();
    });
    expect(isAgentReply(reply)).toBe(false);
    const turns = await extractTurnsChatGPT();
    expect(turns.map(t => t.id)).not.toContain(IDS[5]);
    expect(turns).toHaveLength(7);
  });

  test('a code block with no <pre> is fenced with its header language, and the header does not leak', async () => {
    const turns = await extractTurnsChatGPT();
    expect(turns[1].content).toBe(
      'Sort the long listing by size:\n```bash\nls -lS\n```\nLargest files come first.'
    );
  });

  test('a code block with a bare <pre> under the header is fenced the same way', async () => {
    const turns = await extractTurnsChatGPT();
    expect(turns[3].content).toBe(
      "Use os.scandir:\n```python\nsorted(os.scandir('.'), key=lambda e: e.stat().st_size)\n```"
    );
  });

  test('the screen-reader headings are not content', async () => {
    const turns = await extractTurnsChatGPT();
    for (const t of turns) {
      expect(t.content).not.toMatch(/You said:|ChatGPT said:/);
    }
  });
});

describe('code-block language comes from the header, not from sniffing', () => {
  // Neither body sniffs to a language: `ls -lS` has no shebang, and the Python
  // line has no def/class/import. A label here can only have been read.
  test.each([
    [0, 'bash'],
    [1, 'python']
  ])('block %i reads as %s', (i, lang) => {
    const code = document.querySelectorAll('[data-code-block] code')[i];
    expect(codeBlockRootOf(code)).toBe(document.querySelectorAll('[data-code-block]')[i]);
    expect(detectCodeLanguage(code, codeBlockRootOf(code))).toBe(lang);
  });
});

describe('reasoning offered on the 2026-10 markup (#400)', () => {
  const workedBlock = () =>
    document.querySelector('[data-turn-key="55555555-5555-4555-8555-555555555555"] [data-chatgpt-agent-turn-start]').parentElement;

  test('a "Worked for" line with its expand button counts, though the button has no text or label', () => {
    expect(offersReasoning(workedBlock())).toBe(true);
    expect(countReasoningAffordances()).toBe(1);
  });

  test('a tool-activity line with no duration is not reasoning', () => {
    const agentBlock = document.querySelector('[data-turn-key="44444444-4444-4444-8444-444444444444"] [data-chatgpt-agent-turn-start]').parentElement;
    agentBlock.querySelector('[class*="activity-header"]').appendChild(document.createElement('button'));
    expect(offersReasoning(agentBlock)).toBe(false);
  });

  test('a duration line with no control has nothing to reveal and does not count', () => {
    // Live: 2 of 38 duration lines carried no control.
    workedBlock().querySelector('button[aria-expanded]').remove();
    expect(countReasoningAffordances()).toBe(0);
  });

  test('counted once per reply, however many controls it carries', () => {
    const line = workedBlock().querySelector('[class*="activity-header"]');
    line.appendChild(document.createElement('button'));
    expect(countReasoningAffordances()).toBe(1);
  });

  test('a reply evicted from the page after it rendered still counts', () => {
    // The old counter read the live DOM at the end of the extraction, which on
    // a virtualized list is one window of the conversation.
    captureRenderedMessages();
    document.querySelector('[data-turn-key="55555555-5555-4555-8555-555555555555"]').remove();
    expect(countReasoningAffordances()).toBe(1);
  });
});

describe('ordering a display:contents reply block', () => {
  // Live: every reply block is display:contents, so its own rect is all zeros.
  // Measured by its own box, all 51 reply blocks in one capture got no order
  // key and were appended at the end of the transcript.
  test('the block is positioned by its first laid-out child', () => {
    const scroller = document.querySelector('[data-app-action-timeline-scroll]');
    Object.defineProperty(scroller, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 1000, configurable: true });
    scroller.getBoundingClientRect = () => ({ top: 0, height: 1000 });

    const block = document.querySelector('[data-turn-key="44444444-4444-4444-8444-444444444444"] [data-chatgpt-agent-turn-start]').parentElement;
    block.getBoundingClientRect = () => ({ top: 0, height: 0 });
    block.children[0].getBoundingClientRect = () => ({ top: 0, height: 0 }); // the marker: display:none
    block.children[1].getBoundingClientRect = () => ({ top: 400, height: 24 });

    expect(layoutRectOf(block, 3)).toEqual({ top: 400, height: 24 });
    expect(measureFromBottom(block, scroller)).toBe(3000 - 400);
  });

  test('an element with no laid-out child still measures as unknown', () => {
    const scroller = document.querySelector('[data-app-action-timeline-scroll]');
    Object.defineProperty(scroller, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 1000, configurable: true });
    const empty = document.createElement('div');
    empty.appendChild(document.createElement('span'));
    expect(measureFromBottom(empty, scroller)).toBeNull();
  });
});

describe('scroll container', () => {
  test('the thread scroller is chosen, not the first <main>', () => {
    const scroller = document.querySelector('[data-app-action-timeline-scroll]');
    Object.defineProperty(scroller, 'scrollHeight', { value: 3273, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 2053, configurable: true });
    scroller.style.overflowY = 'auto';

    expect(findScrollContainer()).toBe(scroller);
  });
});

/**
 * Unit tests for Claude-specific extraction in content.js.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 * No untrusted content is involved — all HTML is static test data.
 */

const {
  getSite,
  extractTitle,
  extractConversationId,
  extractTextContent,
  extractUserTurn,
  extractAssistantTurnClaude,
  extractTurnsClaude,
  extractTurns,
  validateSelectors,
  countMessages
} = require('../extensions/src/content.js');

// Load Claude selectors for these tests
const { SELECTORS: CLAUDE_SELECTORS } = require('../extensions/src/selectors-claude.js');

// Save original SELECTORS so we can restore after each test
const { SELECTORS: GEMINI_SELECTORS } = require('../extensions/src/selectors.js');

function useClaude() {
  global.SELECTORS = CLAUDE_SELECTORS;
  if (typeof window !== 'undefined') window.SELECTORS = CLAUDE_SELECTORS;
}

function useGemini() {
  global.SELECTORS = GEMINI_SELECTORS;
  if (typeof window !== 'undefined') window.SELECTORS = GEMINI_SELECTORS;
}

beforeEach(() => {
  useClaude();
  document.body.innerHTML = '';
});

afterEach(() => {
  // Restore Gemini selectors as default (other test files expect this)
  useGemini();
});

describe('getSite (Claude)', () => {
  test('returns claude when Claude selectors loaded', () => {
    expect(getSite()).toBe('claude');
  });

  test('returns gemini when Gemini selectors loaded', () => {
    useGemini();
    expect(getSite()).toBe('gemini');
  });
});

describe('extractTitle (Claude)', () => {
  test('strips " - Claude" suffix from document.title', () => {
    document.title = 'Engineering-first AI solution - Claude';
    expect(extractTitle()).toBe('Engineering-first AI solution');
  });

  test('returns document title as-is when no suffix', () => {
    document.title = 'My Conversation';
    expect(extractTitle()).toBe('My Conversation');
  });

  test('returns Untitled Conversation for empty title', () => {
    document.title = '';
    expect(extractTitle()).toBe('Untitled Conversation');
  });
});

describe('extractConversationId (Claude)', () => {
  const originalLocation = window.location;

  afterEach(() => {
    delete window.location;
    window.location = originalLocation;
  });

  test('extracts UUID from Claude URL', () => {
    delete window.location;
    window.location = { pathname: '/chat/b5b2d739-81b0-4ee7-aa1a-3209c66c25d0' };
    expect(extractConversationId()).toBe('b5b2d739-81b0-4ee7-aa1a-3209c66c25d0');
  });

  test('returns unknown for non-matching URL', () => {
    delete window.location;
    window.location = { pathname: '/settings' };
    expect(extractConversationId()).toBe('unknown');
  });
});

describe('countMessages (Claude)', () => {
  test('counts user and assistant messages (row-start-2)', () => {
    document.body.innerHTML = [
      '<div data-testid="user-message">Hello</div>',
      '<div class="row-start-2">First response</div>',
      '<div data-testid="user-message">Follow up</div>',
      '<div class="row-start-2">Second response</div>'
    ].join('');
    expect(countMessages()).toBe(4);
  });

  test('does NOT count action-bar-copy buttons (user messages have them too)', () => {
    // Regression for #32: copy buttons appear on both user and assistant
    // messages. Only .row-start-2 identifies an assistant turn.
    document.body.innerHTML = [
      '<div data-testid="user-message">Hello</div>',
      '<button data-testid="action-bar-copy"></button>',
      '<button data-testid="action-bar-copy"></button>'
    ].join('');
    expect(countMessages()).toBe(1);
  });

  test('returns 0 when no messages', () => {
    document.body.innerHTML = '<div>No conversation here</div>';
    expect(countMessages()).toBe(0);
  });
});

describe('extractAssistantTurnClaude', () => {
  test('extracts thinking from .row-start-1', () => {
    const div = document.createElement('div');
    const thinking = document.createElement('div');
    thinking.className = 'row-start-1';
    thinking.textContent = "Analyzing the user's request carefully.";
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = 'Here is my response.';
    div.appendChild(thinking);
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.role).toBe('assistant');
    expect(turn.thinking).toBe("Analyzing the user's request carefully.");
    expect(turn.content).toBe('Here is my response.');
  });

  test('extracts response without thinking', () => {
    const div = document.createElement('div');
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = 'Simple response without thinking.';
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 1);

    expect(turn.thinking).toBeNull();
    expect(turn.content).toBe('Simple response without thinking.');
  });

  test('extracts tool use labels', () => {
    const div = document.createElement('div');
    const thinking = document.createElement('div');
    thinking.className = 'row-start-1';
    const p = document.createElement('p');
    p.textContent = 'Let me check the time.';
    thinking.appendChild(p);
    const btn = document.createElement('button');
    btn.className = 'group/row';
    btn.textContent = 'Get current time';
    thinking.appendChild(btn);
    div.appendChild(thinking);
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = 'The current time is 3:00 PM.';
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.toolUse).toEqual(['Get current time']);
  });

  test('preserves code blocks in response', () => {
    const div = document.createElement('div');
    const response = document.createElement('div');
    response.className = 'row-start-2';
    const text = document.createTextNode("Here's the code:");
    response.appendChild(text);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.setAttribute('data-language', 'python');
    code.textContent = 'print("hello")';
    pre.appendChild(code);
    response.appendChild(pre);
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.content).toContain('```python');
    expect(turn.content).toContain('print("hello")');
  });

  test('extracts images from assistant turn', () => {
    const div = document.createElement('div');
    const response = document.createElement('div');
    response.className = 'row-start-2';
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,abc123';
    response.appendChild(img);
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.attachments).toHaveLength(1);
    expect(turn.attachments[0].type).toBe('image');
  });

  test('marks turn as thinking-only when content empty but thinking present (issue #37)', () => {
    const div = document.createElement('div');
    const thinking = document.createElement('div');
    thinking.className = 'row-start-1';
    thinking.textContent = 'Refined email structure and incorporated confidentiality safeguards';
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = '';
    div.appendChild(thinking);
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 7);

    expect(turn.content).toBe('');
    expect(turn.thinking).toContain('Refined email structure');
    expect(turn.type).toBe('thinking-only');
  });

  test('omits type field on normal turns with real content', () => {
    const div = document.createElement('div');
    const thinking = document.createElement('div');
    thinking.className = 'row-start-1';
    thinking.textContent = 'Quick thought';
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = 'Here is a real answer.';
    div.appendChild(thinking);
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.content).toBe('Here is a real answer.');
    expect(turn.type).toBeUndefined();
  });

  test('omits type field when both content and thinking are empty', () => {
    const div = document.createElement('div');
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = '';
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.content).toBe('');
    expect(turn.thinking).toBeNull();
    expect(turn.type).toBeUndefined();
  });

  test('whitespace-only content still triggers thinking-only marker', () => {
    const div = document.createElement('div');
    const thinking = document.createElement('div');
    thinking.className = 'row-start-1';
    thinking.textContent = 'reasoning text';
    const response = document.createElement('div');
    response.className = 'row-start-2';
    response.textContent = '   \n\t  ';
    div.appendChild(thinking);
    div.appendChild(response);

    const turn = extractAssistantTurnClaude(div, 0);

    expect(turn.type).toBe('thinking-only');
  });

  test('preserves nested row-start-1 inside row-start-2 (real Claude normal-turn shape, issue #39)', () => {
    // Real Claude DOM for NORMAL (non-artifact) turns:
    //   div.font-claude-response
    //     div.row-start-1                     (outer thinking title — remove)
    //     div.row-start-2                     (response wrapper — keep)
    //       div.row-start-1.col-start-1...    (INNER response body — KEEP)
    // PR #40 blindly removed every .row-start-1 including the nested inner
    // one, wiping out the actual response on all normal turns. The fix must
    // remove only outer .row-start-1 (not inside a .row-start-2).
    const body = document.createElement('div');
    body.className = 'font-claude-response';

    const outerThinking = document.createElement('div');
    outerThinking.className = 'row-start-1';
    outerThinking.textContent = 'Thinking title that should be removed';
    body.appendChild(outerThinking);

    const responseWrapper = document.createElement('div');
    responseWrapper.className = 'row-start-2';
    const innerResponse = document.createElement('div');
    innerResponse.className = 'row-start-1 col-start-1 relative z-[2]';
    innerResponse.textContent = '[Model: claude-opus-4-6 | Turn ID: 1 | Time: ...]\nThe real response body lives here.';
    responseWrapper.appendChild(innerResponse);
    body.appendChild(responseWrapper);

    const turn = extractAssistantTurnClaude(body, 1);

    expect(turn.content).toContain('Turn ID: 1');
    expect(turn.content).toContain('The real response body lives here');
    expect(turn.content).not.toContain('Thinking title that should be removed');
    expect(turn.thinking).toContain('Thinking title that should be removed');
  });

  test('captures commentary prose sibling of row-start-2 (artifact turn, issue #39)', () => {
    // Mirrors real Claude DOM for artifact turns (email drafts, PDF edits):
    //   div (per-turn container)
    //     div.font-claude-response
    //       div.row-start-1 (thinking title)
    //       div.row-start-1 (tool-use row — optional)
    //       div.row-start-2 (artifact widget — textContent often empty
    //                        because artifact renders via iframe/shadow)
    //       div
    //         div.standard-markdown
    //           p [Model: claude-opus-4-6 | Turn ID: 4 | Time: ...]
    //           p "The equipment ask does the heavy lifting..."
    const turnWrapper = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'font-claude-response';

    const thinking = document.createElement('div');
    thinking.className = 'row-start-1';
    thinking.textContent = 'Refined email structure';
    body.appendChild(thinking);

    const toolRow = document.createElement('div');
    toolRow.className = 'row-start-1';
    body.appendChild(toolRow);

    const artifactWidget = document.createElement('div');
    artifactWidget.className = 'row-start-2';
    // Artifact widget has no accessible textContent (simulating iframe/shadow)
    body.appendChild(artifactWidget);

    const commentaryWrap = document.createElement('div');
    const markdown = document.createElement('div');
    markdown.className = 'standard-markdown';
    const header = document.createElement('p');
    header.className = 'font-claude-response-body';
    header.textContent = '[Model: claude-opus-4-6 | Turn ID: 4 | Time: 2026-04-17 09:31 CT]';
    const para = document.createElement('p');
    para.className = 'font-claude-response-body';
    para.textContent = 'The equipment ask does the heavy lifting. It gives the email a natural reason to exist.';
    markdown.appendChild(header);
    markdown.appendChild(para);
    commentaryWrap.appendChild(markdown);
    body.appendChild(commentaryWrap);

    turnWrapper.appendChild(body);

    const turn = extractAssistantTurnClaude(turnWrapper, 7);

    expect(turn.content).toContain('Turn ID: 4');
    expect(turn.content).toContain('The equipment ask does the heavy lifting');
    expect(turn.thinking).toContain('Refined email structure');
    // With real commentary captured, this is NOT a thinking-only turn
    expect(turn.type).toBeUndefined();
  });
});

describe('extractTurnsClaude', () => {
  test('extracts turns from Claude DOM in order', async () => {
    // Build DOM programmatically
    const user1 = document.createElement('div');
    user1.setAttribute('data-testid', 'user-message');
    user1.textContent = 'Hello Claude';
    document.body.appendChild(user1);

    const grid1 = document.createElement('div');
    grid1.className = 'grid-container';
    const copy1 = document.createElement('div');
    copy1.setAttribute('data-testid', 'action-bar-copy');
    grid1.appendChild(copy1);
    const resp1 = document.createElement('div');
    resp1.className = 'row-start-2';
    resp1.textContent = 'Hi! How can I help?';
    grid1.appendChild(resp1);
    document.body.appendChild(grid1);

    const user2 = document.createElement('div');
    user2.setAttribute('data-testid', 'user-message');
    user2.textContent = 'What is 2+2?';
    document.body.appendChild(user2);

    const grid2 = document.createElement('div');
    grid2.className = 'grid-container';
    const copy2 = document.createElement('div');
    copy2.setAttribute('data-testid', 'action-bar-copy');
    grid2.appendChild(copy2);
    const think2 = document.createElement('div');
    think2.className = 'row-start-1';
    think2.textContent = 'Simple math calculation.';
    grid2.appendChild(think2);
    const resp2 = document.createElement('div');
    resp2.className = 'row-start-2';
    resp2.textContent = '2+2 equals 4.';
    grid2.appendChild(resp2);
    document.body.appendChild(grid2);

    const turns = await extractTurnsClaude();

    expect(turns).toHaveLength(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Hello Claude');
    expect(turns[1].role).toBe('assistant');
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toBe('What is 2+2?');
    expect(turns[3].role).toBe('assistant');
  });
});

describe('extractTurnsClaude with shared grid ancestor (regression #25)', () => {
  // Reproduces the reported bug where a macro grid ancestor wraps the
  // entire conversation. The previous implementation used
  // element.closest('[class*="grid"]') which resolved to the macro grid for
  // every assistant turn, causing every turn's .querySelector('.row-start-2')
  // to return the first turn's content. Verify each assistant content and
  // thinking field is now unique to its turn.
  test('extracts distinct content per assistant turn when ancestors share a grid class', async () => {
    const macroGrid = document.createElement('div');
    macroGrid.className = 'conversation grid grid-rows-auto';

    function appendUser(text) {
      const u = document.createElement('div');
      u.setAttribute('data-testid', 'user-message');
      u.textContent = text;
      macroGrid.appendChild(u);
    }

    function appendAssistant(thinkingText, responseText) {
      const perTurn = document.createElement('div');
      perTurn.className = 'message-layout';

      const thinking = document.createElement('div');
      thinking.className = 'row-start-1';
      thinking.textContent = thinkingText;
      perTurn.appendChild(thinking);

      const response = document.createElement('div');
      response.className = 'row-start-2';
      response.textContent = responseText;
      perTurn.appendChild(response);

      const actionBar = document.createElement('div');
      actionBar.className = 'action-bar';
      const copy = document.createElement('button');
      copy.setAttribute('data-testid', 'action-bar-copy');
      actionBar.appendChild(copy);
      perTurn.appendChild(actionBar);

      macroGrid.appendChild(perTurn);
    }

    appendUser('first user message');
    appendAssistant('first turn thinking', 'first turn response');
    appendUser('second user message');
    appendAssistant('second turn thinking', 'second turn response');
    appendUser('third user message');
    appendAssistant('third turn thinking', 'third turn response');

    document.body.appendChild(macroGrid);

    const turns = await extractTurnsClaude();

    expect(turns).toHaveLength(6);

    const assistantTurns = turns.filter(t => t.role === 'assistant');
    expect(assistantTurns).toHaveLength(3);

    expect(assistantTurns[0].content).toBe('first turn response');
    expect(assistantTurns[1].content).toBe('second turn response');
    expect(assistantTurns[2].content).toBe('third turn response');

    expect(assistantTurns[0].thinking).toBe('first turn thinking');
    expect(assistantTurns[1].thinking).toBe('second turn thinking');
    expect(assistantTurns[2].thinking).toBe('third turn thinking');

    const contents = new Set(assistantTurns.map(t => t.content));
    expect(contents.size).toBe(3);
  });
});

describe('extractTurnsClaude with real Claude DOM shape (regression #32)', () => {
  // Reproduces the real Claude DOM structure captured via DevTools on a
  // 19-turn live conversation:
  //   - Conversation column <div class="flex-1 flex flex-col..."> contains
  //     alternating user-turn and assistant-turn wrappers.
  //   - Each user-turn wrapper holds <div data-testid="user-message"> AND
  //     its own [data-testid="action-bar-copy"] button.
  //   - Each assistant-turn wrapper holds .row-start-1 (thinking/toolUse)
  //     + .row-start-2 (response) + its own [data-testid="action-bar-copy"].
  //
  // The previous selector (action-bar-copy) matched BOTH user and assistant
  // copy buttons, producing 2 entries per turn with duplicated content.
  // Fix: enumerate by .row-start-2 (one per assistant turn).

  function buildRealClaudeDOM(turns) {
    const conversationColumn = document.createElement('div');
    conversationColumn.className = 'flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1';

    function actionBar() {
      const outer = document.createElement('div');
      outer.className = 'flex justify-start opacity-0 group-hover:opacity-100';
      const wrap1 = document.createElement('div');
      wrap1.className = 'text-text-300';
      const wrap2 = document.createElement('div');
      wrap2.className = 'text-text-300 flex items-stretch justify-between';
      const wFit = document.createElement('div');
      wFit.className = 'w-fit';
      const copy = document.createElement('button');
      copy.setAttribute('data-testid', 'action-bar-copy');
      wFit.appendChild(copy);
      wrap2.appendChild(wFit);
      wrap1.appendChild(wrap2);
      outer.appendChild(wrap1);
      return outer;
    }

    for (const turn of turns) {
      if (turn.role === 'user') {
        const outer = document.createElement('div');
        const group = document.createElement('div');
        group.className = 'mb-1 mt-6 group';
        const flexCol = document.createElement('div');
        flexCol.className = 'flex flex-col items-end gap-1';
        const userMsg = document.createElement('div');
        userMsg.setAttribute('data-testid', 'user-message');
        userMsg.textContent = turn.content;
        flexCol.appendChild(userMsg);
        flexCol.appendChild(actionBar());
        group.appendChild(flexCol);
        outer.appendChild(group);
        conversationColumn.appendChild(outer);
      } else {
        const outer = document.createElement('div');
        const group = document.createElement('div');
        group.className = 'group';
        if (turn.thinking) {
          const think = document.createElement('div');
          think.className = 'row-start-1';
          think.textContent = turn.thinking;
          group.appendChild(think);
        }
        if (turn.toolUse) {
          const toolRow = document.createElement('div');
          toolRow.className = 'row-start-1';
          const btn = document.createElement('button');
          btn.className = 'group/row';
          btn.textContent = turn.toolUse;
          toolRow.appendChild(btn);
          group.appendChild(toolRow);
        }
        const resp = document.createElement('div');
        resp.className = 'row-start-2';
        resp.textContent = turn.content;
        group.appendChild(resp);
        group.appendChild(actionBar());
        outer.appendChild(group);
        conversationColumn.appendChild(outer);
      }
    }

    document.body.appendChild(conversationColumn);
  }

  test('19-turn conversation yields 19 user + 19 assistant with unique content', async () => {
    const turnSpecs = [];
    for (let i = 1; i <= 19; i++) {
      turnSpecs.push({ role: 'user', content: `user message ${i}` });
      turnSpecs.push({
        role: 'assistant',
        content: `assistant response ${i}`,
        thinking: `thinking for turn ${i}`,
        toolUse: i % 3 === 0 ? `tool-call-${i}` : null
      });
    }
    buildRealClaudeDOM(turnSpecs);

    const turns = await extractTurnsClaude();

    expect(turns).toHaveLength(38);

    const userTurns = turns.filter(t => t.role === 'user');
    const assistantTurns = turns.filter(t => t.role === 'assistant');
    expect(userTurns).toHaveLength(19);
    expect(assistantTurns).toHaveLength(19);

    const contents = new Set(assistantTurns.map(t => t.content));
    expect(contents.size).toBe(19);

    const thinkings = new Set(assistantTurns.map(t => t.thinking));
    expect(thinkings.size).toBe(19);

    for (let i = 0; i < 19; i++) {
      expect(assistantTurns[i].content).toBe(`assistant response ${i + 1}`);
      expect(assistantTurns[i].thinking).toContain(`thinking for turn ${i + 1}`);
    }

    const toolUses = assistantTurns.filter(t => t.toolUse && t.toolUse.length > 0);
    expect(toolUses.length).toBe(6);
  });

  test('user copy buttons do NOT inflate assistant count', async () => {
    buildRealClaudeDOM([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', thinking: 'greeting' },
      { role: 'user', content: 'how are you' },
      { role: 'assistant', content: 'fine', thinking: 'status' }
    ]);

    const copyBtns = document.querySelectorAll('[data-testid="action-bar-copy"]');
    expect(copyBtns.length).toBe(4);

    const turns = await extractTurnsClaude();
    expect(turns).toHaveLength(4);
    expect(turns.filter(t => t.role === 'assistant')).toHaveLength(2);
    expect(countMessages()).toBe(4);
  });

  test('role alternation is correct (no consecutive duplicates)', async () => {
    buildRealClaudeDOM([
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A1', thinking: 'T1' },
      { role: 'user', content: 'U2' },
      { role: 'assistant', content: 'A2', thinking: 'T2' },
      { role: 'user', content: 'U3' },
      { role: 'assistant', content: 'A3', thinking: 'T3' }
    ]);

    const turns = await extractTurnsClaude();
    const roles = turns.map(t => t.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  });
});

describe('extractTurns dispatches by site', () => {
  test('uses Claude extraction when site is claude', async () => {
    useClaude();

    const user = document.createElement('div');
    user.setAttribute('data-testid', 'user-message');
    user.textContent = 'Hello';
    document.body.appendChild(user);

    const grid = document.createElement('div');
    grid.className = 'grid-container';
    const copy = document.createElement('div');
    copy.setAttribute('data-testid', 'action-bar-copy');
    grid.appendChild(copy);
    const resp = document.createElement('div');
    resp.className = 'row-start-2';
    resp.textContent = 'Hi!';
    grid.appendChild(resp);
    document.body.appendChild(grid);

    const turns = await extractTurns();

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
  });
});

describe('fixture-based Claude extraction', () => {
  beforeEach(() => {
    useClaude();
    setFixture('claude-conversation.html');
    // setFixture only sets body.innerHTML; jsdom doesn't parse <title> from body
    document.title = 'Engineering-first AI solution - Claude';
  });

  test('counts messages in Claude fixture', () => {
    expect(countMessages()).toBe(4); // 2 user + 2 assistant
  });

  test('extracts title from Claude fixture', () => {
    expect(extractTitle()).toBe('Engineering-first AI solution');
  });

  test('fixture has expected Claude structure', () => {
    const userMsgs = document.querySelectorAll('[data-testid="user-message"]');
    const assistantMsgs = document.querySelectorAll('[data-testid="action-bar-copy"]');
    expect(userMsgs.length).toBe(2);
    expect(assistantMsgs.length).toBe(2);
  });

  test('extracts all turns from Claude fixture', async () => {
    const turns = await extractTurns();

    expect(turns.length).toBe(4);

    // Turn 0: user
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('help me design a system architecture');

    // Turn 1: assistant with thinking + code
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].thinking).toContain('Analyzing the request');
    expect(turns[1].content).toContain('```python');
    expect(turns[1].content).toContain('SystemArchitecture');

    // Turn 2: user with image
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toContain('real-time data processing');
    expect(turns[2].attachments).toHaveLength(1);

    // Turn 3: assistant without thinking
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].content).toContain('event-driven architecture');
  });

  test('extracts tool use from first assistant turn', async () => {
    const turns = await extractTurns();
    expect(turns[1].toolUse).toEqual(['Get current time']);
  });
});

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
  test('counts user and assistant messages', () => {
    document.body.innerHTML = [
      '<div data-testid="user-message">Hello</div>',
      '<div data-testid="action-bar-copy"></div>',
      '<div data-testid="user-message">Follow up</div>',
      '<div data-testid="action-bar-copy"></div>'
    ].join('');
    expect(countMessages()).toBe(4);
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

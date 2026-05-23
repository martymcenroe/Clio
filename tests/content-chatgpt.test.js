/**
 * Unit tests for ChatGPT-specific extraction in content.js.
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
  extractAssistantTurnChatGPT,
  extractTurnsChatGPT,
  extractTurns,
  countMessages
} = require('../extensions/src/content.js');

// Load ChatGPT selectors for these tests
const { SELECTORS: CHATGPT_SELECTORS } = require('../extensions/src/selectors-chatgpt.js');

// Save original SELECTORS so we can restore after each test
const { SELECTORS: GEMINI_SELECTORS } = require('../extensions/src/selectors.js');

function useChatGPT() {
  global.SELECTORS = CHATGPT_SELECTORS;
  if (typeof window !== 'undefined') window.SELECTORS = CHATGPT_SELECTORS;
}

function useGemini() {
  global.SELECTORS = GEMINI_SELECTORS;
  if (typeof window !== 'undefined') window.SELECTORS = GEMINI_SELECTORS;
}

beforeEach(() => {
  useChatGPT();
  document.body.innerHTML = '';
});

afterEach(() => {
  // Restore Gemini selectors as default (other test files expect this)
  useGemini();
});

describe('getSite (ChatGPT)', () => {
  test('returns chatgpt when ChatGPT selectors loaded', () => {
    expect(getSite()).toBe('chatgpt');
  });

  test('returns gemini when Gemini selectors loaded', () => {
    useGemini();
    expect(getSite()).toBe('gemini');
  });
});

describe('extractTitle (ChatGPT)', () => {
  test('returns document title as-is (no suffix to strip)', () => {
    document.title = 'Python lambda closure issue';
    expect(extractTitle()).toBe('Python lambda closure issue');
  });

  test('returns Untitled Conversation for empty title', () => {
    document.title = '';
    expect(extractTitle()).toBe('Untitled Conversation');
  });

  test('does not strip " - Gemini" when on ChatGPT', () => {
    document.title = 'Some title - Gemini';
    expect(extractTitle()).toBe('Some title - Gemini');
  });
});

describe('extractConversationId (ChatGPT)', () => {
  const originalLocation = window.location;

  afterEach(() => {
    delete window.location;
    window.location = originalLocation;
  });

  test('extracts UUID from ChatGPT URL', () => {
    delete window.location;
    window.location = { pathname: '/c/67bd8097-de20-8013-82de-4fb74629b1b3' };
    expect(extractConversationId()).toBe('67bd8097-de20-8013-82de-4fb74629b1b3');
  });

  test('returns unknown for non-matching URL', () => {
    delete window.location;
    window.location = { pathname: '/settings' };
    expect(extractConversationId()).toBe('unknown');
  });
});

describe('countMessages (ChatGPT)', () => {
  test('counts user and assistant message elements', () => {
    // NOTE: innerHTML with static test data only (jsdom, no browser, no untrusted content)
    document.body.innerHTML = [
      '<div data-message-author-role="user">Hello</div>',
      '<div data-message-author-role="assistant">Hi!</div>',
      '<div data-message-author-role="user">Follow up</div>',
      '<div data-message-author-role="assistant">Sure</div>'
    ].join('');
    expect(countMessages()).toBe(4);
  });

  test('returns 0 when no message elements', () => {
    document.body.innerHTML = '<div>No conversation here</div>';
    expect(countMessages()).toBe(0);
  });
});

describe('extractAssistantTurnChatGPT', () => {
  test('extracts markdown content from assistant turn', () => {
    const msgDiv = document.createElement('div');
    msgDiv.setAttribute('data-message-author-role', 'assistant');
    msgDiv.setAttribute('data-message-model-slug', 'gpt-4o');
    const markdown = document.createElement('div');
    markdown.className = 'markdown prose';
    markdown.textContent = 'The strangler pattern is used for migration.';
    msgDiv.appendChild(markdown);

    const turn = extractAssistantTurnChatGPT(msgDiv, 0);

    expect(turn.role).toBe('assistant');
    expect(turn.content).toContain('strangler pattern');
    expect(turn.modelSlug).toBe('gpt-4o');
    expect(turn.thinking).toBeNull();
  });

  test('extracts reasoning label from o1 turn', () => {
    const msgDiv = document.createElement('div');
    msgDiv.setAttribute('data-message-author-role', 'assistant');
    msgDiv.setAttribute('data-message-model-slug', 'o1');

    // Reasoning header (inside the message element on modern DOM)
    const reasoningDiv = document.createElement('div');
    reasoningDiv.className = 'flex items-start gap-3 pb-2';
    const btn = document.createElement('button');
    btn.textContent = 'Reasoned about architecture for 8 seconds';
    reasoningDiv.appendChild(btn);
    msgDiv.appendChild(reasoningDiv);

    // Response content
    const markdown = document.createElement('div');
    markdown.className = 'markdown prose';
    markdown.textContent = 'Based on your diagram...';
    msgDiv.appendChild(markdown);

    const turn = extractAssistantTurnChatGPT(msgDiv, 0);

    expect(turn.thinking).toContain('Reasoned about architecture');
    expect(turn.content).toContain('Based on your diagram');
    expect(turn.modelSlug).toBe('o1');
  });

  test('extracts code blocks from assistant turn', () => {
    const msgDiv = document.createElement('div');
    msgDiv.setAttribute('data-message-author-role', 'assistant');
    const markdown = document.createElement('div');
    markdown.className = 'markdown';
    const text = document.createTextNode("Here's the code:");
    markdown.appendChild(text);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.setAttribute('data-language', 'python');
    code.textContent = 'print("hello")';
    pre.appendChild(code);
    markdown.appendChild(pre);
    msgDiv.appendChild(markdown);

    const turn = extractAssistantTurnChatGPT(msgDiv, 0);

    expect(turn.content).toContain('```python');
    expect(turn.content).toContain('print("hello")');
  });

  test('extracts images from assistant turn', () => {
    const msgDiv = document.createElement('div');
    msgDiv.setAttribute('data-message-author-role', 'assistant');
    const markdown = document.createElement('div');
    markdown.className = 'markdown';
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,abc123';
    markdown.appendChild(img);
    msgDiv.appendChild(markdown);

    const turn = extractAssistantTurnChatGPT(msgDiv, 0);

    expect(turn.attachments).toHaveLength(1);
    expect(turn.attachments[0].type).toBe('image');
  });
});

describe('extractTurnsChatGPT', () => {
  test('extracts turns from ChatGPT DOM in order', async () => {
    // Build DOM programmatically to avoid innerHTML
    const user1 = document.createElement('div');
    user1.setAttribute('data-message-author-role', 'user');
    user1.setAttribute('data-message-id', 'u1');
    const u1text = document.createElement('div');
    u1text.className = 'whitespace-pre-wrap';
    u1text.textContent = 'Hello ChatGPT';
    user1.appendChild(u1text);
    document.body.appendChild(user1);

    const assist1 = document.createElement('div');
    assist1.setAttribute('data-message-author-role', 'assistant');
    assist1.setAttribute('data-message-id', 'a1');
    assist1.setAttribute('data-message-model-slug', 'gpt-4o');
    const a1md = document.createElement('div');
    a1md.className = 'markdown';
    a1md.textContent = 'Hi! How can I help?';
    assist1.appendChild(a1md);
    document.body.appendChild(assist1);

    const user2 = document.createElement('div');
    user2.setAttribute('data-message-author-role', 'user');
    user2.setAttribute('data-message-id', 'u2');
    const u2text = document.createElement('div');
    u2text.className = 'whitespace-pre-wrap';
    u2text.textContent = 'What is 2+2?';
    user2.appendChild(u2text);
    document.body.appendChild(user2);

    const assist2 = document.createElement('div');
    assist2.setAttribute('data-message-author-role', 'assistant');
    assist2.setAttribute('data-message-id', 'a2');
    const a2md = document.createElement('div');
    a2md.className = 'markdown';
    a2md.textContent = '2+2 equals 4.';
    assist2.appendChild(a2md);
    document.body.appendChild(assist2);

    const turns = await extractTurnsChatGPT();

    expect(turns).toHaveLength(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('Hello ChatGPT');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('How can I help');
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toContain('What is 2+2');
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].content).toContain('2+2 equals 4');
  });
});

describe('extractTurns dispatches to ChatGPT', () => {
  test('uses ChatGPT extraction when site is chatgpt', async () => {
    useChatGPT();

    const user = document.createElement('div');
    user.setAttribute('data-message-author-role', 'user');
    user.setAttribute('data-message-id', 'u1');
    const utext = document.createElement('div');
    utext.className = 'whitespace-pre-wrap';
    utext.textContent = 'Hello';
    user.appendChild(utext);
    document.body.appendChild(user);

    const assist = document.createElement('div');
    assist.setAttribute('data-message-author-role', 'assistant');
    assist.setAttribute('data-message-id', 'a1');
    const amd = document.createElement('div');
    amd.className = 'markdown';
    amd.textContent = 'Hi!';
    assist.appendChild(amd);
    document.body.appendChild(assist);

    const turns = await extractTurns();

    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
  });
});

describe('fixture-based ChatGPT extraction', () => {
  beforeEach(() => {
    useChatGPT();
    setFixture('chatgpt-conversation.html');
    document.title = 'Python lambda closure issue';
  });

  test('counts messages in ChatGPT fixture', () => {
    expect(countMessages()).toBe(4); // 2 user + 2 assistant
  });

  test('extracts title from ChatGPT fixture', () => {
    expect(extractTitle()).toBe('Python lambda closure issue');
  });

  test('fixture has expected ChatGPT structure', () => {
    const userMsgs = document.querySelectorAll('[data-message-author-role="user"]');
    const assistantMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    expect(userMsgs.length).toBe(2);
    expect(assistantMsgs.length).toBe(2);
  });

  test('extracts all turns from ChatGPT fixture', async () => {
    const turns = await extractTurns();

    expect(turns.length).toBe(4);

    // Turn 0: user
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('strangler pattern');

    // Turn 1: assistant with code (gpt-4o, no thinking)
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('Strangler Pattern');
    expect(turns[1].content).toContain('```python');
    expect(turns[1].content).toContain('StranglerFacade');
    expect(turns[1].thinking).toBeNull();
    expect(turns[1].modelSlug).toBe('gpt-4o');

    // Turn 2: user with image
    expect(turns[2].role).toBe('user');
    expect(turns[2].content).toContain('current architecture');
    expect(turns[2].attachments).toHaveLength(1);

    // Turn 3: assistant with reasoning (o1)
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].thinking).toContain('Reasoned about strangler pattern');
    expect(turns[3].content).toContain('API gateway');
    expect(turns[3].modelSlug).toBe('o1');
  });
});

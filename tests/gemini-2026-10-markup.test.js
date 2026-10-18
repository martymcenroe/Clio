/**
 * Gemini's 2026-10 markup: the first measurement of Gemini text extraction
 * (#309), through the real extension on 2026-10-18.
 *
 *   - every message carried its screen-reader heading ("You said" with a
 *     truncated copy of the prompt, "Gemini said") as text (#421);
 *   - a code block's header label became the code's first line (#422);
 *   - the export was titled with the mode picker's label, "Auto" (#423);
 *   - no imagesOffered, so a missed image could not be reported (#424);
 *   - paragraphs ran together (#426, the shared fix).
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const {
  extractTurnsGemini,
  extractTitle,
  extractTextContent,
  geminiPromptLines,
  countImagesOffered,
  resetMessageCache,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

const originalFetch = global.fetch;
const originalTitle = document.title;

beforeEach(() => {
  global.SELECTORS = GEMINI;
  resetMessageCache();
  document.body.innerHTML = loadFixture('gemini-conversation-2026-10.html');
  document.title = 'Bash File Size Listing Command - Google Gemini';
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['jpg'], { type: 'image/jpeg' }) }));
});

afterEach(() => {
  global.fetch = originalFetch;
  document.title = originalTitle;
  resetMessageCache();
});

describe('message text without the screen-reader labels (#421)', () => {
  test('each prompt is its own text, once', async () => {
    const turns = await extractTurnsGemini();
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(turns[0].content).toBe(
      'Clio extraction test (#309, #331). Reply with one short sentence, then a two-line bash code block that lists files by size, biggest first.');
    expect(turns[2].content).toBe(
      'Clio image-capture test (#331). Generate an image: a flat blue circle centred on a plain yellow background, no text.');
  });

  test('a prompt typed on three lines keeps its three lines', async () => {
    const turns = await extractTurnsGemini();
    expect(turns[4].content).toBe([
      'Clio extraction test (#309), a prompt on three lines.',
      'This is the second line.',
      'Reply with two short paragraphs, then a three-line poem with one line per line.'
    ].join('\n'));
  });

  test('no message carries "You said" or "Gemini said"', async () => {
    const turns = await extractTurnsGemini();
    for (const t of turns) {
      expect(t.content).not.toMatch(/You said|Gemini said/);
    }
  });

  test('a reply holding only a generated image has empty text and the image', async () => {
    const turns = await extractTurnsGemini();
    expect(turns[3].content).toBe('');
    expect(turns[3].attachments.map(a => a.originalSrc)).toEqual(['blob:https://gemini.google.com/gemini-test-image-0001']);
  });

  test('a prompt without line elements keeps the reading it had', () => {
    document.body.innerHTML = '<user-query><div class="query-text">plain prompt</div></user-query>';
    expect(geminiPromptLines(document.querySelector('user-query'))).toBeNull();
  });

  test('only the template space at each end of a line is removed', () => {
    document.body.innerHTML = '<user-query><p class="query-text-line">   indented code </p><p class="query-text-line"> </p><p class="query-text-line"> next </p></user-query>';
    expect(geminiPromptLines(document.querySelector('user-query'))).toBe('  indented code\n\nnext');
  });
});

describe('code block (#422)', () => {
  test('one fence, its language from the header, the code exact', async () => {
    const turns = await extractTurnsGemini();
    expect(turns[1].content).toBe(
      'Here is the requested file listing ordered by size.\n```bash\n#!/bin/bash\nls -laS\n```');
  });

  test('nothing of the header is left in the text', async () => {
    const turns = await extractTurnsGemini();
    expect(turns[1].content).not.toMatch(/Bash#|Download code|Copy code/);
    expect(turns[1].content.match(/```/g)).toHaveLength(2);
  });
});

describe('paragraphs stay apart (#426)', () => {
  test('a two-paragraph reply and a poem, as the page shows them', async () => {
    const turns = await extractTurnsGemini();
    expect(turns[5].content).toBe([
      'This is a response to the multi-line prompt test. The second line was acknowledged as requested.',
      '',
      'The format follows the specified requirements with two short paragraphs preceding the verse.',
      '',
      'A bright blue dot,\nOn yellow space,\nA simple spot.'
    ].join('\n'));
  });
});

describe('title (#423)', () => {
  test('the conversation title, not the mode picker\'s "Auto"', () => {
    expect(extractTitle()).toBe('Bash File Size Listing Command');
  });

  test('not the screen-reader heading either', () => {
    document.querySelector('bard-mode-switcher').remove();
    expect(extractTitle()).toBe('Bash File Size Listing Command');
  });

  test('a page titled only with the product has no title of its own', () => {
    document.title = 'Google Gemini';
    expect(extractTitle()).toBe('Untitled Conversation');
    document.title = 'Gemini';
    expect(extractTitle()).toBe('Untitled Conversation');
  });

  test('the older " - Gemini" suffix is still removed', () => {
    document.title = 'Old title - Gemini';
    expect(extractTitle()).toBe('Old title');
  });
});

describe('images offered (#424)', () => {
  const FAST = {
    scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 5, mutationTimeout: 10,
    maxScrollAttempts: 5, loadingCheckInterval: 5, maxLoadingWait: 20,
    progressUpdateInterval: 2, topSettleRounds: 1, minTopWaitMs: 0
  };
  beforeEach(() => setScrollConfig(FAST));
  afterEach(() => resetScrollConfig());

  test('the generated image counts; the avatar outside the conversation does not', () => {
    expect(countImagesOffered()).toBe(1);
  });

  test('a captured image leaves the export complete', async () => {
    const result = await extractConversation();
    expect(result.success).toBe(true);
    const m = result.data.metadata;
    expect(m.imagesOffered).toBe(1);
    expect(m.imageCount).toBe(1);
    expect(m.incompleteReasons.join(' ')).not.toContain('were not captured');
    expect(m.title).toBe('Bash File Size Listing Command');
  });

  test('an image the message extraction cannot reach makes the export incomplete', async () => {
    // Moved out of the reply but left in the exchange: offered, never found.
    const img = document.querySelector('generated-image img');
    document.getElementById('c2').appendChild(img);
    const result = await extractConversation();
    const m = result.data.metadata;
    expect(m.imagesOffered).toBe(1);
    expect(m.imageCount).toBe(0);
    expect(m.incompleteReasons).toContain('1 of 1 image(s) on the page were not captured');
    expect(m.contentComplete).toBe(false);
  });
});

describe('shared text extraction', () => {
  test('an element matching the site\'s textChrome is left out of the text', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span class="cdk-visually-hidden">hidden</span><p>shown</p>';
    expect(extractTextContent(div)).toBe('shown');
  });
});

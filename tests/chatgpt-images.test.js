/**
 * ChatGPT images (#410, #411; part of #331).
 *
 * Measured through the real extension on 2026-10-17: a test conversation with
 * one uploaded image and one generated image exported 3 messages and 0 images,
 * and said nothing was missing. Three causes, each pinned below against a
 * fixture copied from the live ancestor chains:
 *
 *   - the generated-image reply had no text, and 1.9.3 counted a reply block
 *     as a message only if it held text — so the reply was not a message;
 *   - the upload sits beside the user's text, and only the text was searched;
 *   - both are blob: URLs, read after the scroll from cached clones, when the
 *     page may already have released them.
 *
 * And the instrument (#410): imagesOffered, counted from each exchange rather
 * than through the message selectors, so an image those selectors miss still
 * shows up as missing instead of as nothing.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const {
  queryMessages,
  isAgentReply,
  holdsReplyText,
  messageIdOf,
  chatgptRoleOf,
  captureRenderedMessages,
  resetMessageCache,
  extractTurnsChatGPT,
  conversationImagesIn,
  countImagesOffered,
  fetchImage,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');
const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

const UPLOAD = 'blob:https://chatgpt.com/11111111-0000-4000-8000-000000000001';
const GENERATED = 'blob:https://chatgpt.com/22222222-0000-4000-8000-000000000002';
const IMAGE_REPLY_ID = '99999999-9999-4999-8999-999999999999';

const originalFetch = global.fetch;

/** A fetch that serves blob URLs while they are "alive", as a page would. */
function blobFetch(alive) {
  return jest.fn(async (src) => {
    if (!alive.has(src)) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, statusText: 'OK', blob: async () => new Blob([`bytes of ${src}`], { type: 'image/png' }) };
  });
}

function use(selectors) {
  global.SELECTORS = selectors;
  if (typeof window !== 'undefined') window.SELECTORS = selectors;
}

const imageReplyBlock = () =>
  document.querySelector('[data-turn-key="88888888-8888-4888-8888-888888888888"] [data-chatgpt-agent-turn-start]').parentElement;

beforeEach(() => {
  use(CHATGPT);
  resetMessageCache();
  document.body.innerHTML = loadFixture('chatgpt-images-2026-10.html');
  global.fetch = blobFetch(new Set([UPLOAD, GENERATED]));
});

afterEach(() => {
  global.fetch = originalFetch;
  resetMessageCache();
  use(GEMINI);
});

describe('the generated-image reply is a message (#411)', () => {
  test('a reply block holding only an image is a reply, though it holds no text', () => {
    expect(holdsReplyText(imageReplyBlock())).toBe(false); // why 1.9.3 dropped it
    expect(isAgentReply(imageReplyBlock())).toBe(true);
  });

  test('it carries its real message id, from the gallery wrapper', () => {
    expect(messageIdOf(imageReplyBlock())).toBe(IMAGE_REPLY_ID);
  });

  test('four messages, in order, with their roles', () => {
    const els = queryMessages(document);
    expect(els.map(chatgptRoleOf)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(els[3]).toBe(imageReplyBlock());
  });
});

describe('images are attached to the messages that hold them (#411)', () => {
  test('the upload beside the text is attached to its user message, and the text is unchanged', async () => {
    captureRenderedMessages();
    const turns = await extractTurnsChatGPT();
    expect(turns[0].content).toBe('Name the colours in this test pattern.');
    expect(turns[0].attachments).toEqual([{ type: 'image', filename: null, originalSrc: UPLOAD }]);
  });

  test('the generated image is attached to its reply', async () => {
    captureRenderedMessages();
    const turns = await extractTurnsChatGPT();
    expect(turns[3]).toMatchObject({ role: 'assistant', id: IMAGE_REPLY_ID, content: '' });
    expect(turns[3].attachments.map(a => a.originalSrc)).toEqual([GENERATED]);
  });
});

describe('blob: bytes are read while the image is on screen (#411)', () => {
  test('an image released by the page after capture still exports its bytes', async () => {
    const alive = new Set([UPLOAD, GENERATED]);
    global.fetch = blobFetch(alive);
    captureRenderedMessages();       // on screen: bytes read now
    alive.clear();                   // the page lets go of both URLs
    document.querySelectorAll('img').forEach(img => img.remove());

    const result = await fetchImage(GENERATED, 3, 1);
    expect(result.blob).toBeInstanceOf(Blob);
    // jsdom's Blob has no text(); the size is the bytes the page served.
    expect(result.blob.size).toBe(`bytes of ${GENERATED}`.length);
    expect(result.filename).toBe('images/001.png');
  });

  test('a cross-origin image that will not fetch names its host, not a bare "Failed to fetch"', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    const result = await fetchImage('https://images.openai.com/thumbnails/x.png', 1, 1);
    expect(result.message).toBe('Failed to fetch (images.openai.com)');
  });

  test('a blob: image never read on screen says why it is missing', async () => {
    global.fetch = blobFetch(new Set());
    const result = await fetchImage(UPLOAD, 0, 1);
    expect(result.blob).toBeUndefined();
    expect(result.message).toMatch(/blob: image no longer available/);
  });
});

describe('imagesOffered counts what the page rendered (#410)', () => {
  test('both images are counted', () => {
    expect(countImagesOffered()).toBe(2);
  });

  test('counted from the exchange, so an image outside every message still counts', () => {
    // A "Worked for" block is not a message; an image there is invisible to
    // the message selectors — and must not be invisible to the count.
    const worked = document.createElement('div');
    worked.className = 'block-BQZwFn';
    worked.innerHTML = '<span data-chatgpt-agent-turn-start></span><div class="extra"><img alt="x" src="blob:https://chatgpt.com/33333333-0000-4000-8000-000000000003"></div>';
    document.querySelector('[data-turn-key="66666666-6666-4666-8666-666666666666"] .flex.flex-col.gap-3').appendChild(worked);
    expect(queryMessages(document)).toHaveLength(5); // it is a reply now: it holds an image
    expect(countImagesOffered()).toBe(3);
  });

  test('a re-render with a fresh blob: URL is still one image', () => {
    captureRenderedMessages();
    document.querySelector(`img[src="${GENERATED}"]`).setAttribute('src', 'blob:https://chatgpt.com/22222222-0000-4000-8000-0000000000ff');
    captureRenderedMessages();
    expect(countImagesOffered()).toBe(2);
  });

  test('an image the page no longer renders still counts, once seen', () => {
    captureRenderedMessages();
    document.querySelector('[data-turn-key="88888888-8888-4888-8888-888888888888"]').remove();
    expect(countImagesOffered()).toBe(2);
  });

  test('a citation favicon is not a conversation image', () => {
    const pill = document.createElement('span');
    pill.setAttribute('data-testid', 'webpage-citation-pill');
    pill.innerHTML = '<img alt="" src="https://www.google.com/s2/favicons?domain=example.com">';
    imageReplyBlock().appendChild(pill);
    expect(conversationImagesIn(imageReplyBlock())).toHaveLength(1);
    expect(countImagesOffered()).toBe(2);
  });

  test('a site with no image scope reports no number rather than a made-up zero', () => {
    use({ ...CHATGPT, imageScope: undefined });
    expect(countImagesOffered()).toBeNull();
  });
});

describe('the export accounts for every image offered (#410)', () => {
  const FAST = {
    scrollStep: 100, scrollDelay: 10, loadingAppearDelay: 5, mutationTimeout: 50,
    maxScrollAttempts: 20, loadingCheckInterval: 10, maxLoadingWait: 100,
    progressUpdateInterval: 2, minTopWaitMs: 0
  };
  beforeEach(() => setScrollConfig(FAST));
  afterEach(() => resetScrollConfig());

  test('every image captured: offered equals imageCount, nothing incomplete about images', async () => {
    const result = await extractConversation();
    expect(result.success).toBe(true);
    const md = result.data.metadata;
    expect(md.imagesOffered).toBe(2);
    expect(md.imageCount).toBe(2);
    expect(md.incompleteReasons.filter(r => /image/.test(r))).toEqual([]);
  });

  test('an image nothing captured makes the export incomplete and says how many', async () => {
    // An image the message selectors cannot reach: inside the exchange, in
    // an element that is not a message.
    const stray = document.createElement('div');
    stray.innerHTML = '<img alt="x" src="blob:https://chatgpt.com/44444444-0000-4000-8000-000000000004">';
    document.querySelector('[data-turn-key="66666666-6666-4666-8666-666666666666"] [data-content-search-turn-key]').appendChild(stray);

    const result = await extractConversation();
    const md = result.data.metadata;
    expect(md.imagesOffered).toBe(3);
    expect(md.imageCount).toBe(2);
    expect(md.contentComplete).toBe(false);
    expect(md.incompleteReasons).toContain('1 of 3 image(s) on the page were not captured');
  });

  test('an image that failed to fetch is accounted for in mediaErrors, not as missing', async () => {
    global.fetch = blobFetch(new Set([UPLOAD])); // the generated one cannot be read
    const result = await extractConversation();
    const md = result.data.metadata;
    expect(md.imageCount).toBe(1);
    expect(md.mediaErrors).toHaveLength(1);
    expect(md.incompleteReasons.filter(r => /image/.test(r))).toEqual([]);
  });
});

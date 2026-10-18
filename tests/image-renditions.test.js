/**
 * Images a site shows as its own reduced copy (#420, #425).
 *
 * Measured through the real extension on 2026-10-18:
 *   - Claude, after a page load, shows an upload from
 *     /api/<org>/files/<id>/preview, a lossy WebP (6,006 bytes for a
 *     3,843-byte PNG); no endpoint for the original was found;
 *   - Gemini shows a generated image from lh3.googleusercontent.com/gg/<token>
 *     =s1024-rj (1024×559, 16,227 bytes) where its own full-size download
 *     asks for =d-I (1408×768, 321,273 bytes), and swaps the src for a blob:
 *     URL once the image is on screen.
 * A reduced copy is replaced by the original where it can be had, and marked
 * where it cannot.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const {
  imageRendition,
  shownAsOf,
  imageAttachment,
  findImages,
  fetchImage,
  watchImageSrcSwaps,
  SRC_ORIGINALS,
  resetMessageCache,
  extractConversation,
  setScrollConfig,
  resetScrollConfig
} = require('../extensions/src/content.js');

const { SELECTORS: CLAUDE } = require('../extensions/src/selectors-claude.js');
const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');
const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

const TOKEN = 'AB12cd34-test-token_gemini-generated-image';
const DISPLAY = `https://lh3.googleusercontent.com/gg/${TOKEN}=s1024-rj`;
const FULL = `https://lh3.googleusercontent.com/gg/${TOKEN}=d-I`;

const originalFetch = global.fetch;
const blobOf = (type, size) => new Blob([new Uint8Array(size)], { type });

afterEach(() => {
  global.fetch = originalFetch;
  SRC_ORIGINALS.clear();
  resetMessageCache();
  global.SELECTORS = GEMINI;
});

describe('which images are a reduced copy', () => {
  test('Claude: an upload shown from /files/<id>/preview or /thumbnail', () => {
    global.SELECTORS = CLAUDE;
    expect(imageRendition('/api/org-1/files/file-1/preview')).toEqual({ rendition: 'preview', fullSize: null });
    expect(imageRendition('https://claude.ai/api/org-1/files/file-1/thumbnail')).toEqual({ rendition: 'preview', fullSize: null });
    expect(imageRendition('blob:https://claude.ai/upload-1')).toBeNull();
  });

  test('Gemini: a size-capped image-service URL, with its full size', () => {
    global.SELECTORS = GEMINI;
    expect(imageRendition(DISPLAY)).toEqual({ rendition: 'display', fullSize: FULL });
    expect(imageRendition(`https://lh3.googleusercontent.com/gg/${TOKEN}=w800-h436`)).toEqual({ rendition: 'display', fullSize: FULL });
  });

  test('Gemini: the full-size URL, the avatar and blob: URLs nobody saw swapped are not', () => {
    global.SELECTORS = GEMINI;
    expect(imageRendition(FULL)).toBeNull();
    expect(imageRendition(`https://lh3.googleusercontent.com/gg/${TOKEN}=s0-d-I`)).toBeNull();
    expect(imageRendition('https://lh3.googleusercontent.com/a/avatar-test=s64-c')).toBeNull();
    expect(imageRendition('blob:https://gemini.google.com/never-seen')).toBeNull();
  });

  test('a site with no rule marks nothing', () => {
    global.SELECTORS = CHATGPT;
    expect(imageRendition(DISPLAY)).toBeNull();
  });
});

describe('a swap from the image-service URL to blob: is remembered (#425)', () => {
  test('the blob: URL then stands for the URL it replaced', async () => {
    global.SELECTORS = GEMINI;
    document.body.innerHTML = `<img id="g" src="${DISPLAY}">`;
    const observer = watchImageSrcSwaps(document.body);
    document.getElementById('g').setAttribute('src', 'blob:https://gemini.google.com/swapped-1');
    await new Promise(r => setTimeout(r, 0));
    observer.disconnect();
    expect(imageRendition('blob:https://gemini.google.com/swapped-1')).toEqual({ rendition: 'display', fullSize: FULL });
  });

  test('a src that was never a reduced copy is not recorded', async () => {
    global.SELECTORS = GEMINI;
    document.body.innerHTML = '<img id="g" src="https://example.com/a.png">';
    const observer = watchImageSrcSwaps(document.body);
    document.getElementById('g').setAttribute('src', 'blob:https://gemini.google.com/other');
    await new Promise(r => setTimeout(r, 0));
    observer.disconnect();
    expect(SRC_ORIGINALS.size).toBe(0);
  });
});

describe('fetching (#420, #425)', () => {
  test('Gemini: the full size is fetched when it can be had, and is not marked', async () => {
    global.SELECTORS = GEMINI;
    global.fetch = jest.fn(async (url) => ({ ok: true, status: 200,
      blob: async () => (url === FULL ? blobOf('image/jpeg', 321) : blobOf('image/jpeg', 16)) }));
    const r = await fetchImage(DISPLAY, 1, 1);
    expect(global.fetch).toHaveBeenCalledWith(FULL, { credentials: 'include' });
    expect(r.blob.size).toBe(321);
    expect(r.fullSize).toBe(true);
    expect(r.rendition).toBeUndefined();
  });

  test('Gemini: when the full size cannot be had, the displayed copy is kept and marked', async () => {
    global.SELECTORS = GEMINI;
    global.fetch = jest.fn(async (url) => {
      if (url === FULL) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, blob: async () => blobOf('image/jpeg', 16) };
    });
    const r = await fetchImage(DISPLAY, 1, 1);
    expect(r.blob.size).toBe(16);
    expect(r.rendition).toBe('display');
  });

  test('Gemini: a full-size response that is not an image is not taken', async () => {
    global.SELECTORS = GEMINI;
    global.fetch = jest.fn(async (url) => ({ ok: true, status: 200,
      blob: async () => (url === FULL ? blobOf('text/html', 900) : blobOf('image/jpeg', 16)) }));
    const r = await fetchImage(DISPLAY, 1, 1);
    expect(r.blob.type).toBe('image/jpeg');
    expect(r.rendition).toBe('display');
  });

  test('Claude: a preview is fetched as shown and marked', async () => {
    global.SELECTORS = CLAUDE;
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => blobOf('image/webp', 60) }));
    const r = await fetchImage('/api/org-1/files/file-1/preview', 0, 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(r.rendition).toBe('preview');
    expect(r.filename).toBe('images/001.webp');
  });
});

describe('the export says so (#420 R3, #425 R3)', () => {
  const FAST = {
    scrollStep: 100, scrollDelay: 5, loadingAppearDelay: 5, mutationTimeout: 10,
    maxScrollAttempts: 5, loadingCheckInterval: 5, maxLoadingWait: 20,
    progressUpdateInterval: 2, topSettleRounds: 1, minTopWaitMs: 0
  };
  beforeEach(() => {
    global.SELECTORS = GEMINI;
    setScrollConfig(FAST);
    document.body.innerHTML = loadFixture('gemini-conversation-2026-10.html');
    document.querySelector('generated-image img').setAttribute('src', DISPLAY);
  });
  afterEach(() => resetScrollConfig());

  test('a displayed copy makes the export incomplete, by name and by count', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === FULL) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, blob: async () => blobOf('image/jpeg', 16) };
    });
    const result = await extractConversation();
    const m = result.data.metadata;
    expect(m.imageCount).toBe(1);
    expect(m.imagesReduced).toBe(1);
    expect(m.incompleteReasons).toContain("1 image(s) are the site's reduced copy, not the original");
    expect(m.contentComplete).toBe(false);
    const att = result.data.messages[3].attachments[0];
    expect(att.rendition).toBe('display');
  });

  test('the full size leaves it complete', async () => {
    global.fetch = jest.fn(async (url) => ({ ok: true, status: 200,
      blob: async () => (url === FULL ? blobOf('image/jpeg', 321) : blobOf('image/jpeg', 16)) }));
    const result = await extractConversation();
    const m = result.data.metadata;
    expect(m.imagesReduced).toBe(0);
    expect(m.contentComplete).toBe(true);
    expect(result.data.messages[3].attachments[0].rendition).toBeUndefined();
  });

  test('a site with no rule reports no count', async () => {
    global.SELECTORS = CHATGPT;
    document.body.innerHTML = '<main><div data-message-author-role="user" data-message-id="u1"><div class="whitespace-pre-wrap">hi</div></div></main>';
    const result = await extractConversation();
    expect(result.data.metadata.imagesReduced).toBeUndefined();
  });

  // The path 1.9.7 missed, measured live: the page fetches the image itself
  // and sets a blob: on a fresh <img>, so its URL is never in the page.
  test('a generated image that is a bare blob: is marked from where it sits', async () => {
    document.querySelector('generated-image img').setAttribute('src', 'blob:https://gemini.google.com/fresh-element');
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, blob: async () => blobOf('image/jpeg', 16) }));
    const result = await extractConversation();
    const m = result.data.metadata;
    expect(global.fetch).toHaveBeenCalledTimes(1);          // nothing to derive a full size from
    expect(m.imagesReduced).toBe(1);
    expect(m.incompleteReasons).toContain("1 image(s) are the site's reduced copy, not the original");
    expect(m.contentComplete).toBe(false);
    const att = result.data.messages[3].attachments[0];
    expect(att.rendition).toBe('display');
    expect(att).not.toHaveProperty('shownAs');               // the hint stays out of the export
  });
});

describe('what an image is shown as, from where it sits (#425)', () => {
  test('Gemini: inside generated-image, the displayed copy; elsewhere, nothing', () => {
    global.SELECTORS = GEMINI;
    document.body.innerHTML = '<generated-image><img id="a" src="blob:x"></generated-image><user-query><img id="b" src="blob:y"></user-query>';
    const found = findImages(document.body, 0);
    expect(found.map(imageAttachment)).toEqual([
      { type: 'image', filename: null, originalSrc: 'blob:x', shownAs: 'display' },
      { type: 'image', filename: null, originalSrc: 'blob:y' }
    ]);
  });

  test('Claude and ChatGPT have no placement rule', () => {
    document.body.innerHTML = '<generated-image><img id="a" src="blob:x"></generated-image>';
    for (const s of [CLAUDE, CHATGPT]) {
      global.SELECTORS = s;
      expect(shownAsOf(document.getElementById('a'))).toBeNull();
    }
  });

  test('a known origin still wins: the full size is tried for a remembered blob:', async () => {
    global.SELECTORS = GEMINI;
    SRC_ORIGINALS.set('blob:https://gemini.google.com/known', DISPLAY);
    global.fetch = jest.fn(async (url) => ({ ok: true, status: 200,
      blob: async () => (url === FULL ? blobOf('image/jpeg', 321) : blobOf('image/jpeg', 16)) }));
    const r = await fetchImage('blob:https://gemini.google.com/known', 1, 1, 'display');
    expect(r.fullSize).toBe(true);
    expect(r.rendition).toBeUndefined();
  });
});

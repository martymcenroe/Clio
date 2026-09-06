/**
 * Citation favicons are decoration, not content (#279).
 *
 * A single 233-message ChatGPT export collected 152 image attachments. Every
 * one was Google's favicon service, every one failed to fetch, the images/
 * folder in the ZIP was empty, and all 152 landed in extractionErrors.
 *
 * The markup in these tests is REAL. `SOURCES_BUTTON_2026_05` is copied from a
 * ChatGPT page saved with Chrome's "Webpage, Single File"; the only edit is
 * truncating the repeated source chips. That matters here more than usual:
 * that snapshot renders the favicon with class="icon-sm", which the site's
 * image selector already excluded via :not([class*="icon"]) — so a fixture
 * invented today would encode the current markup, pass, and hide the fact that
 * the URL test is the half doing the work when the class goes away.
 */

const {
  findImages,
  isCitationDecoration,
  resetDecorationCount,
  getDecorationCount,
  extractImages
} = require('../extensions/src/content.js');

const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');
const { SELECTORS: GEMINI } = require('../extensions/src/selectors.js');

// Verbatim from a saved ChatGPT page, 2026-05. Note class="icon-sm".
const SOURCES_BUTTON_2026_05 = `
<button class="group/footnote bg-token-bg-primary flex w-fit items-center gap-1.5 rounded-3xl py-1.5 ps-3 pe-3" aria-label="Sources">
  <div class="flex flex-row-reverse">
    <div class="border-token-bg-primary bg-token-bg-primary flex items-center overflow-clip rounded-full -ms-1.5 first:me-0 border-2 relative">
      <div class="relative inline-block shrink-0">
        <img alt="" width="32" height="32" class="icon-sm rounded-full border border-token-border-light border-[0.5px] duration-200 motion-safe:transition-opacity opacity-100" src="https://www.google.com/s2/favicons?domain=https://www.dice.com&amp;sz=32">
      </div>
    </div>
  </div>
</button>`;

// The 2026-09 form: same service, larger size, and no "icon" class — which is
// how 152 of these reached the fetcher.
const SOURCES_BUTTON_2026_09 = `
<button class="group/footnote flex w-fit items-center gap-1.5" aria-label="Sources">
  <div class="relative inline-block shrink-0">
    <img alt="" width="128" height="128" class="rounded-full border" src="https://www.google.com/s2/favicons?domain=https://arxiv.org&amp;sz=128">
  </div>
</button>`;

const REAL_IMAGE =
  '<img alt="a chart the user pasted" src="https://files.oaiusercontent.com/file-abc123">';

function messageWith(html) {
  document.body.innerHTML =
    `<div data-message-author-role="assistant">${html}</div>`;
  return document.querySelector('[data-message-author-role="assistant"]');
}

describe('isCitationDecoration', () => {
  beforeEach(() => {
    global.SELECTORS = CHATGPT;
    resetDecorationCount();
  });

  // Test ID: DECOR-001
  test('the 2026-09 favicon that reached the fetcher is decoration', () => {
    const el = messageWith(SOURCES_BUTTON_2026_09);
    const img = el.querySelector('img');

    expect(isCitationDecoration(img)).toBe(true);
  });

  // Test ID: DECOR-002
  test('the 2026-05 favicon is decoration too, by URL when the class is gone', () => {
    const el = messageWith(SOURCES_BUTTON_2026_05);
    const img = el.querySelector('img');

    expect(isCitationDecoration(img)).toBe(true);
  });

  // Test ID: DECOR-003 — the URL half must stand alone, since it is the only
  // half that works on a site whose citation container has never been verified.
  test('a favicon-service URL is decoration with no citation container at all', () => {
    const el = messageWith(
      '<img alt="" src="https://www.google.com/s2/favicons?domain=https://nature.com&sz=128">');
    const img = el.querySelector('img');

    expect(isCitationDecoration(img)).toBe(true);
  });

  // Test ID: DECOR-004 — and the role half must stand alone, so a provider swap
  // does not silently reintroduce 152 failures per capture.
  test('an unknown favicon provider inside the Sources button is still decoration', () => {
    const el = messageWith(`
      <button aria-label="Sources">
        <img alt="" src="https://icons.example-cdn.net/favicon/openai.com.png">
      </button>`);
    const img = el.querySelector('img');

    expect(isCitationDecoration(img)).toBe(true);
  });

  // Test ID: DECOR-005 — the check that must NOT get louder.
  test('a real pasted image is not decoration', () => {
    const el = messageWith(REAL_IMAGE);
    const img = el.querySelector('img');

    expect(isCitationDecoration(img)).toBe(false);
  });

  // Test ID: DECOR-006 — "small image with no alt" describes a favicon and also
  // describes an inline diagram. The test keys on neither.
  test('a small image with empty alt outside a citation is not decoration', () => {
    const el = messageWith(
      '<img alt="" width="16" height="16" src="https://files.oaiusercontent.com/file-tiny">');
    const img = el.querySelector('img');

    expect(isCitationDecoration(img)).toBe(false);
  });

  // Test ID: DECOR-007
  test('other known favicon services are covered', () => {
    for (const src of [
      'https://t1.gstatic.com/faviconV2?url=https://example.com',
      'https://icons.duckduckgo.com/ip3/example.com.ico',
      'https://example.com/favicon.ico'
    ]) {
      const el = messageWith(`<img alt="" src="${src}">`);
      expect(isCitationDecoration(el.querySelector('img'))).toBe(true);
    }
  });

  // Test ID: DECOR-008 — Gemini and Claude declare no citation container, so
  // the role half is inert there. The URL half must still fire.
  test('a favicon is decoration on a site with no citationDecoration selector', () => {
    global.SELECTORS = GEMINI;
    expect(GEMINI.citationDecoration).toBeNull();

    const el = messageWith(
      '<img alt="" src="https://www.google.com/s2/favicons?domain=https://who.int&sz=128">');

    expect(isCitationDecoration(el.querySelector('img'))).toBe(true);
  });
});

describe('findImages excludes decoration from attachments', () => {
  beforeEach(() => {
    global.SELECTORS = CHATGPT;
    resetDecorationCount();
  });

  // Test ID: DECOR-010 — the accounting complaint in #279: 294 attachment
  // entries where 142 were meaningful.
  test('a message with citations and one real image yields one attachment', () => {
    const el = messageWith(
      SOURCES_BUTTON_2026_09 + SOURCES_BUTTON_2026_05 + REAL_IMAGE);

    const found = findImages(el, 0);

    expect(found).toHaveLength(1);
    expect(found[0].src).toContain('files.oaiusercontent.com');
  });

  // Test ID: DECOR-011 — skipped, not vanished.
  //
  // One, not two: the 2026-05 chip carries class="icon-sm" and never reaches
  // this filter, because SELECTORS.image excludes it with :not([class*="icon"])
  // first. That is the whole reason #279 was invisible for months and then
  // arrived 152 at a time — the count here is the live form only, and it is
  // the number that would go back up if the decoration test regressed.
  test('skipped decoration is counted', () => {
    const el = messageWith(SOURCES_BUTTON_2026_09 + SOURCES_BUTTON_2026_05);

    findImages(el, 0);

    expect(getDecorationCount()).toBe(1);
  });

  // Test ID: DECOR-012
  test('the counter resets between extractions', () => {
    const el = messageWith(SOURCES_BUTTON_2026_09);
    findImages(el, 0);
    expect(getDecorationCount()).toBe(1);

    resetDecorationCount();

    expect(getDecorationCount()).toBe(0);
  });
});

describe('a clean capture can report zero errors', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.SELECTORS = CHATGPT;
    resetDecorationCount();
  });
  afterAll(() => { global.fetch = originalFetch; });

  // Test ID: DECOR-020 — the assertion #279 calls the one worth having: before
  // this change, "no errors" was not a state the tool could reach on any
  // conversation that cited a source.
  test('citation favicons produce no fetches and no errors', async () => {
    const fetchSpy = jest.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')));
    global.fetch = fetchSpy;

    const el = messageWith(SOURCES_BUTTON_2026_09 + SOURCES_BUTTON_2026_05);
    const turns = [{
      index: 0,
      role: 'assistant',
      content: 'cited two sources',
      attachments: findImages(el, 0).map(img => ({
        type: 'image', filename: null, originalSrc: img.src
      }))
    }];

    const { images, errors } = await extractImages(turns);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(images).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  // Test ID: DECOR-021 — a real image that genuinely fails must still be
  // reported. Quieting the list is the failure mode being avoided, not the fix.
  test('a real image that fails to fetch is still an error', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')));

    const el = messageWith(SOURCES_BUTTON_2026_09 + REAL_IMAGE);
    const turns = [{
      index: 0,
      role: 'assistant',
      content: 'one citation, one real image',
      attachments: findImages(el, 0).map(img => ({
        type: 'image', filename: null, originalSrc: img.src
      }))
    }];

    const { images, errors } = await extractImages(turns);

    expect(images).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].originalSrc).toContain('files.oaiusercontent.com');
  });
});

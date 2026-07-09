/* global document */
// Clio 2.0 — conversation-list enumeration (#54).
//
// Walk the site's conversation list, scrolling until it stops growing (the list
// lazy-loads more from the server as you scroll), and return every conversation
// as { conversation_id, url, title }. Pure DOM — no API. The batch worker (#60)
// turns this into the queue it drains.
//
// `collectConversations()` is a pure reader (unit-tested against real captured
// DOM). `enumerateAll()` adds the scroll loop for the live page.

function cleanTitle(t) {
  t = (t || '').replace(/\s+/g, ' ').trim();
  const h = t.length / 2; // sidebar rows sometimes duplicate the title (visible + tooltip)
  if (t.length && t.length % 2 === 0 && t.slice(0, h) === t.slice(h)) t = t.slice(0, h);
  return t.trim();
}

// Per-site list selectors. Each site renders conversation rows differently, and
// Claude renders them BOTH as data-row-key buttons and as href anchors depending
// on UI state — handle both.
const SITE_LISTS = {
  claude: {
    itemSelector: '[data-row-key^="chat:"], a[href^="/chat/"]',
    idFromItem(el) {
      const key = el.getAttribute('data-row-key');
      if (key && key.indexOf('chat:') === 0) return key.slice(5) || null;
      const href = el.getAttribute('href') || '';
      const m = href.match(/\/chat\/([0-9a-f-]+)/i);
      return m ? m[1] : null;
    },
    urlFromId: (id) => `https://claude.ai/chat/${id}`,
    titleFromItem: (el) => cleanTitle(el.textContent),
  },
  gemini: {
    itemSelector: 'a[data-test-id="conversation"]',
    idFromItem(el) {
      const m = (el.getAttribute('href') || '').match(/\/app\/([0-9a-z]+)/i);
      return m ? m[1] : null;
    },
    urlFromId: (id) => `https://gemini.google.com/app/${id}`,
    titleFromItem(el) {
      const t = el.querySelector('.conversation-title');
      return cleanTitle((t || el).textContent);
    },
  },
  // chatgpt: pending its real list DOM (#195)
};

/** Read every conversation currently rendered in `root` for `site` (deduped). */
function collectConversations(root, site) {
  const cfg = SITE_LISTS[site];
  if (!cfg) throw new Error(`no list config for site: ${site}`);
  const out = [];
  const seen = new Set();
  for (const el of root.querySelectorAll(cfg.itemSelector)) {
    const id = cfg.idFromItem(el);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ site, conversation_id: id, url: cfg.urlFromId(id), title: cfg.titleFromItem(el) });
  }
  return out;
}

/** Find the scrollable ancestor that actually holds the conversation list. */
function findListScroller(itemSelector) {
  const item = document.querySelector(itemSelector);
  if (!item) return null;
  let el = item.parentElement;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Scroll the list until it stops growing, accumulating every conversation.
 * The list lazy-loads from the server as you reach the bottom, so keep going
 * until the count is stable across several settle cycles.
 */
async function enumerateAll(site, opts = {}) {
  const cfg = SITE_LISTS[site];
  const { maxRounds = 400, settleMs = 700, stableNeeded = 6 } = opts;
  const wait = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const all = new Map();
  const absorb = () => {
    for (const c of collectConversations(document, site)) if (!all.has(c.conversation_id)) all.set(c.conversation_id, c);
  };

  let stable = 0;
  absorb();
  for (let i = 0; i < maxRounds && stable < stableNeeded; i++) {
    const before = all.size;
    const scroller = findListScroller(cfg.itemSelector);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const items = document.querySelectorAll(cfg.itemSelector);
    if (items.length) items[items.length - 1].scrollIntoView({ block: 'end' });
    await wait(settleMs); // let the server lazy-load the next page
    absorb();
    stable = all.size === before ? stable + 1 : 0;
  }
  return [...all.values()];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { collectConversations, enumerateAll, findListScroller, cleanTitle, SITE_LISTS };
}

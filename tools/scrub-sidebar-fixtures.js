#!/usr/bin/env node
/**
 * Turn a raw sidebar capture into a committable enumeration fixture (#283, #248).
 *
 * `tests/enumerate.test.js` runs against real captured sidebar DOM rather than
 * hand-written markup, deliberately: the selectors in `extensions/src/enumerate.js`
 * exist to survive a real site's framework markup, and a fixture someone typed by
 * hand tests the fixture, not the site. But a raw capture is the operator's own
 * conversation list, and this repo is public, so the raw capture cannot be
 * committed.
 *
 * This is the reconciliation. It keeps every matched row's real markup -- tags,
 * classes, attributes, nesting -- and replaces only the two things the test does
 * not read: the conversation ids and the human-readable text. The assertions are
 * row count, URL shape, id uniqueness and a non-empty title. None of them ever
 * needed the real values.
 *
 * Two decisions worth knowing before you change it:
 *
 * - Page chrome outside the rows is DROPPED, not scrubbed. No assertion reads it,
 *   it is the bulk of the bytes, and it is where account identity lives. Scrubbing
 *   content you cannot enumerate is not something you can verify; dropping it is.
 *
 * - An attribute is rewritten only when its value actually contains one of THIS
 *   capture's ids or one of its text values. An earlier version treated every
 *   attribute value of 8+ characters as suspect and clobbered
 *   `data-test-id="conversation"` -- a framework constant, identical for every
 *   user, and the exact hook the selector matches on. It emitted 53 rows that the
 *   reader then skipped, and the fixture looked fine.
 *
 * The run verifies its own output from disk: no id or text value from the capture
 * may survive anywhere in the file, and re-reading the fixture through the real
 * `collectConversations` must return the expected row count with unique ids,
 * correct URL shape, non-empty titles, and no value that came from the capture.
 * A failure exits non-zero. Nothing here ever prints a real title or id.
 *
 * Usage:
 *   node tools/scrub-sidebar-fixtures.js <capture-dir> [out-dir]
 *
 * <capture-dir> holds the raw captures under the same filenames as the fixtures
 * (sidebar-claude.html, sidebar-gemini.html). [out-dir] defaults to
 * tests/fixtures.
 *
 * Requires jsdom, which currently resolves only TRANSITIVELY through
 * jest-environment-jsdom rather than being declared. That works today and is not
 * something to rely on; declaring it is tracked separately.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CAPTURES = process.argv[2];
const OUTDIR = process.argv[3] || path.resolve(__dirname, '..', 'tests', 'fixtures');

if (!CAPTURES) {
  console.error('usage: node tools/scrub-sidebar-fixtures.js <capture-dir> [out-dir]');
  process.exit(2);
}

const SITES = [
  {
    site: 'claude',
    file: 'sidebar-claude.html',
    expected: 32,
    itemSelector: '[data-row-key^="chat:"], a[href^="/chat/"]',
    realId: (el) => {
      const key = el.getAttribute('data-row-key');
      if (key && key.indexOf('chat:') === 0) return key.slice(5) || null;
      const m = (el.getAttribute('href') || '').match(/\/chat\/([0-9a-f-]+)/i);
      return m ? m[1] : null;
    },
    // v4-shaped, because the test's URL assertion reads /^[0-9a-f-]+$/.
    synthId: (i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    setId: (el, id) => {
      if (el.hasAttribute('data-row-key')) el.setAttribute('data-row-key', `chat:${id}`);
      el.setAttribute('href', `/chat/${id}`);
    },
    urlOk: (r) => /^https:\/\/claude\.ai\/chat\/[0-9a-f-]+$/.test(r.url),
  },
  {
    site: 'gemini',
    file: 'sidebar-gemini.html',
    expected: 53,
    itemSelector: 'a[data-test-id="conversation"]',
    realId: (el) => {
      const m = (el.getAttribute('href') || '').match(/\/app\/([0-9a-z]+)/i);
      return m ? m[1] : null;
    },
    synthId: (i) => `c${String(i + 1).padStart(15, '0')}`,
    // Unconditional, not a regex replace on the existing value: the attribute
    // sweep legitimately rewrites href (it carries the real id), so a
    // `/app/<id>` pattern has nothing left to match and the replace silently
    // no-ops -- which is how the reader came to skip every row.
    setId: (el, id) => el.setAttribute('href', `/app/${id}`),
    urlOk: (r) => r.url.startsWith('https://gemini.google.com/app/'),
  },
];

function* walkText(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    for (const c of n.childNodes) {
      if (c.nodeType === 3) yield c;
      else stack.push(c);
    }
  }
}

const WORDS = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Ginkgo', 'Hazel',
  'Ironwood', 'Juniper', 'Katsura', 'Larch', 'Maple', 'Nutmeg', 'Oak', 'Poplar'];
const synthTitle = (i) => `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length].toLowerCase()} notes ${i + 1}`;

const { collectConversations, cleanTitle } = require(path.resolve(__dirname, '..', 'extensions', 'src', 'enumerate.js'));

let failures = 0;

for (const cfg of SITES) {
  const src = path.join(CAPTURES, cfg.file);
  if (!fs.existsSync(src)) {
    console.error(`${cfg.site}: no capture at ${src} -- skipping`);
    failures += 1;
    continue;
  }
  const doc = new JSDOM(fs.readFileSync(src, 'utf8')).window.document;
  const outPath = path.join(OUTDIR, cfg.file);

  const rows = [...doc.querySelectorAll(cfg.itemSelector)];
  if (!rows.length) throw new Error(`${cfg.site}: selector matched nothing in the capture`);

  // Per-component <style> blocks inside rows are CSS no selector reads.
  let stylesDropped = 0;
  for (const el of rows) {
    for (const s of el.querySelectorAll('style, script')) { s.remove(); stylesDropped += 1; }
  }

  // Captured values, taken before anything is touched, so the residue check has
  // something to search for. Never printed.
  const realIds = new Set();
  const realTitles = new Set();
  const realText = new Set();
  for (const el of rows) {
    const id = cfg.realId(el);
    if (id) realIds.add(id);
    const t = cleanTitle(el.textContent);
    if (t) realTitles.add(t);
    for (const node of walkText(el)) {
      const v = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (v.length >= 4) realText.add(v);
    }
  }

  let attrsRewritten = 0;
  rows.forEach((el, i) => {
    const title = synthTitle(i);

    let first = true;
    for (const node of walkText(el)) {
      if (!node.nodeValue.trim()) continue;
      node.nodeValue = first ? title : `item ${i + 1}`;
      first = false;
    }
    if (first) el.appendChild(doc.createTextNode(title)); // no text at all; the title assertion needs one

    for (const node of [el, ...el.querySelectorAll('*')]) {
      for (const attr of node.getAttributeNames()) {
        const v = node.getAttribute(attr);
        if (!v) continue;
        const norm = v.replace(/\s+/g, ' ').trim();
        const carriesId = [...realIds].some((r) => v.includes(r));
        const carriesText = [...realText].some((r) => r.length >= 8 && norm.includes(r));
        if (carriesId || carriesText) {
          node.setAttribute(attr, /^href$/i.test(attr) ? `/scrubbed/${cfg.synthId(i)}` : title);
          attrsRewritten += 1;
        }
      }
    }

    // Structural for the selectors, so it goes on last -- after the sweep above,
    // which may have rewritten it.
    cfg.setId(el, cfg.synthId(i));
  });

  const body = rows.map((el) => '    ' + el.outerHTML).join('\n');
  fs.writeFileSync(outPath, `<!DOCTYPE html>
<!--
  Sidebar list fixture for ${cfg.site} (#283, #248).

  Real captured row elements -- real tags, classes, attributes and nesting, which
  is what enumerate.js walks -- with conversation ids and all human-readable text
  replaced by synthetic values. This repo is public and the capture was of a real
  account, so the real values are not committable; the assertions (row count, URL
  shape, id uniqueness, title non-empty) never needed them.

  Page chrome outside the rows was dropped rather than scrubbed: no assertion
  reads it, and it is not enumerable enough to certify clean.

  Regenerate from a fresh capture with:
    node tools/scrub-sidebar-fixtures.js <capture-dir>
-->
<html>
  <body>
${body}
  </body>
</html>
`, 'utf8');

  // ---- verification, re-read from disk -------------------------------------
  const written = fs.readFileSync(outPath, 'utf8');
  const leakedIds = [...realIds].filter((r) => written.includes(r));
  const leakedText = [...realText].filter((r) => r.length >= 12 && written.includes(r));

  const got = collectConversations(new JSDOM(written).window.document, cfg.site);
  const ids = new Set(got.map((r) => r.conversation_id));
  const idEscaped = got.some((r) => realIds.has(r.conversation_id));
  const titleEscaped = got.some((r) => realTitles.has(r.title));
  const shapeOk = got.every(cfg.urlOk);
  const titlesOk = got.every((r) => r.title);

  const ok = !leakedIds.length && !leakedText.length && !idEscaped && !titleEscaped &&
    got.length === cfg.expected && ids.size === got.length && shapeOk && titlesOk;

  console.log(`${cfg.site}: rows ${got.length}/${cfg.expected}  unique ${ids.size}  ` +
    `urlShape ${shapeOk}  titles ${titlesOk}  stylesDropped ${stylesDropped}  ` +
    `attrsRewritten ${attrsRewritten}  residue ${leakedIds.length}id/${leakedText.length}text  ` +
    `readerLeak ${idEscaped || titleEscaped}  bytes ${written.length}`);
  if (!ok) failures += 1;
}

process.exit(failures ? 1 : 0);

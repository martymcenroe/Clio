// Focused probe: what does a ChatGPT turn look like NOW? Read-only, attaches
// over CDP to the open window. Never clicks, never navigates, never closes the
// browser.
//
//   node tools/chatgpt/probe-turns.js
//
// Written for #399, where validateSelectors() found no
// `[data-message-author-role]` on a live conversation and every extraction
// failed with "Missing selectors: messages". It answers the three questions
// that decide the fix, in order:
//
//   1. Does the old selector match anything, in the document, in an open
//      shadow root, or in a same-origin frame? (Reachability, not existence.)
//   2. Which data-* attributes and data-testid values does <main> carry, with
//      counts? A renamed role attribute shows up here with a count close to the
//      number of turns on screen.
//   3. What is the ancestor chain above the elements that hold message text?
//      The content selectors (.markdown, .whitespace-pre-wrap) are tried
//      first, because the turn boundary is somewhere above them.
//
// Prints structure only — tag names, attribute names and values that are
// identifiers, class names, counts and text LENGTHS. No conversation text:
// Clio is public and the output of a probe gets pasted into issues.

const { chromium } = require('@playwright/test');

const PORT = Number(process.env.CLIO_PORT || 9333);
const say = (s) => process.stdout.write(s + '\n');

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = null;
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com\/(?:.*\/)?c\//.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) {
    const urls = browser.contexts().flatMap((c) => c.pages().map((p) => p.url()));
    say('no ChatGPT conversation page attached. Open pages:');
    for (const u of urls) say(`  ${u}`);
    return;
  }

  const report = await page.evaluate(() => {
    const OLD = '[data-message-author-role="user"], [data-message-author-role="assistant"]';

    // Attribute VALUES are printed only for attributes that carry identifiers,
    // never for anything that could hold text.
    const SAFE_VALUE_ATTRS = new Set([
      'data-testid', 'data-message-author-role', 'data-turn', 'data-role',
      'data-author', 'data-message-model-slug', 'data-scroll-anchor', 'role'
    ]);

    const desc = (el) => {
      let s = el.tagName.toLowerCase();
      const attrs = [];
      for (const a of el.attributes) {
        if (a.name === 'class' || a.name === 'style') continue;
        if (a.name.startsWith('data-') || a.name === 'role' || a.name === 'id') {
          attrs.push(SAFE_VALUE_ATTRS.has(a.name) ? `${a.name}="${a.value.slice(0, 40)}"` : a.name);
        }
      }
      if (attrs.length) s += `[${attrs.join(' ')}]`;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      if (cls.length) s += '.' + cls.slice(0, 4).join('.');
      if (el.shadowRoot) s += ' {shadow}';
      return s;
    };

    const chain = (el, depth) => {
      const out = [];
      let cur = el;
      while (cur && cur !== document.documentElement && out.length < depth) {
        out.push(desc(cur));
        cur = cur.parentElement;
      }
      return out;
    };

    // 1. Reachability of the old selector.
    const inDocument = document.querySelectorAll(OLD).length;
    let shadowHosts = 0, inShadow = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.shadowRoot) {
        shadowHosts++;
        inShadow += el.shadowRoot.querySelectorAll(OLD).length;
      }
    }
    const frames = [...document.querySelectorAll('iframe')].map((f) => {
      let reachable = false, inFrame = null;
      try {
        const d = f.contentDocument;
        if (d) { reachable = true; inFrame = d.querySelectorAll(OLD).length; }
      } catch { /* cross-origin: reported as unreachable */ }
      return { src: (f.getAttribute('src') || '').slice(0, 80), reachable, inFrame };
    });

    // 2. data-* attribute census. Over the whole body, not <main>: on
    // 2026-10-17 <main> held the app shell and the composer and nothing else,
    // so a census scoped to it could not see the thread wherever it now lives.
    const main = document.querySelector('main');
    const scope = document.body;
    const attrCounts = {};
    const testidCounts = {};
    {
      for (const el of scope.querySelectorAll('*')) {
        for (const a of el.attributes) {
          if (!a.name.startsWith('data-')) continue;
          attrCounts[a.name] = (attrCounts[a.name] || 0) + 1;
          if (a.name === 'data-testid') {
            // Collapse per-turn numbering so conversation-turn-1..N count as one.
            const key = a.value.replace(/\d+/g, 'N');
            testidCounts[key] = (testidCounts[key] || 0) + 1;
          }
        }
      }
    }

    // 3. Ancestor chains above the content holders.
    const contentSelectors = ['.markdown', '.whitespace-pre-wrap', '[data-message-id]', 'article', '[data-turn]', 'section', 'p'];
    const chains = {};
    const counts = {};
    for (const sel of contentSelectors) {
      const els = [...scope.querySelectorAll(sel)];
      counts[sel] = els.length;
      chains[sel] = els.slice(0, 2).map((el) => ({
        textLength: (el.innerText || '').length,
        chain: chain(el, 12)
      }));
    }

    // 4. Turn anatomy. On 2026-10-17 the census above showed the 2026-05
    // attributes gone and a new family in their place: data-turn-key per turn,
    // data-user-message-bubble and data-chatgpt-agent-turn-start, and
    // data-conversation-role. Their values, and what one turn of each kind
    // contains, decide the new selectors.
    const valuesOf = (name) => {
      const out = {};
      for (const el of document.querySelectorAll(`[${name}]`)) {
        const v = el.getAttribute(name);
        // Identifiers are reported by shape, not by value.
        const k = /^[0-9a-f-]{20,}$/i.test(v) ? `<id len ${v.length}>` : v.slice(0, 40);
        out[k] = (out[k] || 0) + 1;
      }
      return out;
    };
    const ROLE_ATTRS = [
      'data-conversation-role', 'data-talvt-turn-state', 'data-user-message-bubble',
      'data-chatgpt-agent-turn-start', 'data-turn-key', 'data-content-search-turn-key',
      'data-chatgpt-selection-message-id', 'data-chatgpt-search-message-ids',
      'data-content-search-unit-key', 'data-markdown-text-style', 'data-code-block',
      'data-virtualized-turn-content'
    ];
    const attrValues = Object.fromEntries(ROLE_ATTRS.map((n) => [n, valuesOf(n)]));

    const turns = [...document.querySelectorAll('[data-turn-key]')];
    const turnRows = turns.map((t, i) => {
      const roles = [...t.querySelectorAll('[data-conversation-role]')].map((e) => e.getAttribute('data-conversation-role'));
      if (t.hasAttribute('data-conversation-role')) roles.unshift(t.getAttribute('data-conversation-role'));
      return {
        i,
        textLength: (t.innerText || '').length,
        top: Math.round(t.getBoundingClientRect().top),
        userBubble: t.querySelectorAll('[data-user-message-bubble]').length,
        agentStart: t.querySelectorAll('[data-chatgpt-agent-turn-start]').length,
        roles,
        messageIds: t.querySelectorAll('[data-chatgpt-selection-message-id]').length,
        markdownRoots: t.querySelectorAll('[data-markdown-text-style]').length,
        pres: t.querySelectorAll('pre').length,
        codeBlocks: t.querySelectorAll('[data-code-block]').length,
        imgs: t.querySelectorAll('img').length,
        virtualized: t.querySelectorAll('[data-virtualized-turn-content]').length
      };
    });

    // An outline of one turn: every element that carries a data-* attribute or
    // is a structural tag, to a bounded number of lines.
    const STRUCT = new Set(['PRE', 'CODE', 'IMG', 'BUTTON', 'P', 'H1', 'H2', 'H3', 'UL', 'OL', 'TABLE', 'A']);
    const outline = (root, maxLines) => {
      const lines = [];
      const walk = (el, depth) => {
        if (lines.length >= maxLines) return;
        const hasData = [...el.attributes].some((a) => a.name.startsWith('data-') || a.name === 'role');
        if (el === root || hasData || STRUCT.has(el.tagName)) {
          lines.push(`${'  '.repeat(Math.min(depth, 20))}${desc(el)}  (text ${(el.innerText || '').length})`);
        }
        for (const c of el.children) walk(c, depth + 1);
      };
      walk(root, 0);
      return lines;
    };
    const firstUser = turns.find((t) => t.querySelector('[data-user-message-bubble]'));
    const firstAgent = turns.find((t) => t.querySelector('[data-chatgpt-agent-turn-start]'));

    // The element that actually scrolls the thread.
    let scroller = null;
    for (let cur = turns[0] ? turns[0].parentElement : null; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const oy = getComputedStyle(cur).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 10) {
        scroller = {
          desc: desc(cur),
          scrollHeight: cur.scrollHeight,
          clientHeight: cur.clientHeight,
          scrollTop: Math.round(cur.scrollTop),
          matchesOld: cur.matches('[class*="scroll-root"]'),
          insideMain: !!cur.closest('main'),
          chain: chain(cur, 6)
        };
        break;
      }
    }
    const turnsInsideMain = turns.filter((t) => t.closest('main')).length;

    return {
      attrValues, turnRows, turnsInsideMain, scroller,
      userOutline: firstUser ? outline(firstUser, 60) : [],
      agentOutline: firstAgent ? outline(firstAgent, 90) : [],
      url: location.href,
      readyState: document.readyState,
      hasMain: !!main,
      mainTextLength: main ? (main.innerText || '').length : 0,
      bodyTextLength: (document.body.innerText || '').length,
      title: document.title.length,
      inDocument, shadowHosts, inShadow, frames,
      attrCounts, testidCounts, counts, chains
    };
  });

  say(`url:        ${report.url}`);
  say(`readyState: ${report.readyState}   <main>: ${report.hasMain}   main text length: ${report.mainTextLength}   body text length: ${report.bodyTextLength}   title length: ${report.title}`);
  say('');
  say('1. the 1.9.1 selector [data-message-author-role="user"|"assistant"]');
  say(`   in document:      ${report.inDocument}`);
  say(`   in shadow roots:  ${report.inShadow}   (open shadow hosts on the page: ${report.shadowHosts})`);
  say(`   iframes:          ${report.frames.length}`);
  for (const f of report.frames) say(`     src=${f.src || '-'}  reachable=${f.reachable}  matches=${f.inFrame}`);
  say('');
  say('2. data-* attributes in the body (count)');
  for (const [k, v] of Object.entries(report.attrCounts).sort((a, b) => b[1] - a[1])) say(`   ${String(v).padStart(5)}  ${k}`);
  say('');
  say('   data-testid values in the body, digits collapsed to N (count)');
  for (const [k, v] of Object.entries(report.testidCounts).sort((a, b) => b[1] - a[1])) say(`   ${String(v).padStart(5)}  ${k}`);
  say('');
  say('3. content holders in the body');
  for (const [sel, n] of Object.entries(report.counts)) {
    say(`   ${sel}: ${n}`);
    for (const [i, c] of report.chains[sel].entries()) {
      say(`     #${i + 1} (text length ${c.textLength}), element first, then ancestors:`);
      for (const line of c.chain) say(`        ${line}`);
    }
  }
  say('');
  say('4. turn anatomy');
  say('   attribute values (identifiers by shape):');
  for (const [name, vals] of Object.entries(report.attrValues)) {
    say(`     ${name}: ${Object.keys(vals).length ? JSON.stringify(vals) : '(absent)'}`);
  }
  say(`   [data-turn-key] turns: ${report.turnRows.length}   of which inside <main>: ${report.turnsInsideMain}`);
  for (const r of report.turnRows) {
    say(`     turn ${r.i}: top ${r.top}  text ${r.textLength}  userBubble ${r.userBubble}  agentStart ${r.agentStart}  roles ${JSON.stringify(r.roles)}  msgIds ${r.messageIds}  markdown ${r.markdownRoots}  pre ${r.pres}  codeBlock ${r.codeBlocks}  img ${r.imgs}  virtualized ${r.virtualized}`);
  }
  say('');
  say('   scroll container above the first turn:');
  if (report.scroller) {
    const s = report.scroller;
    say(`     ${s.desc}`);
    say(`     scrollHeight ${s.scrollHeight}  clientHeight ${s.clientHeight}  scrollTop ${s.scrollTop}  matches 1.9.1 [class*="scroll-root"]: ${s.matchesOld}  inside <main>: ${s.insideMain}`);
    for (const line of s.chain.slice(1)) say(`       ^ ${line}`);
  } else {
    say('     none found');
  }
  say('');
  say('   first USER turn outline:');
  for (const line of report.userOutline) say(`     ${line}`);
  say('');
  say('   first ASSISTANT turn outline:');
  for (const line of report.agentOutline) say(`     ${line}`);
  // No browser.close() — the operator owns that window.
}

main().catch((e) => {
  say('PROBE ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
}).finally(() => process.exit(process.exitCode || 0));

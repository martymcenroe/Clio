// Run the extension's real extractConversation() against the LIVE ChatGPT
// page and report what it produced, structurally.
//
//   node tools/chatgpt/verify-extract.js
//
// Written for #399, where ChatGPT replaced its thread markup and every
// extraction failed before it began with "Missing selectors: messages". The
// fixture tests passed throughout, because the fixture still carried the old
// markup — so the only test that can say the fix works is the real code on the
// real page.
//
// Injects extensions/src/selectors-chatgpt.js and extensions/src/content.js
// verbatim, as verify-live.js does, but inside ONE function scope: both files
// declare top-level `const`/`let`, and a second injection into the global scope
// of the same page throws "has already been declared". Scoped, the script can
// be re-run without reloading the page.
//
// It scrolls the conversation exactly as the extension does (the real
// scrollToLoadAllMessages, with its real patience), so a long conversation
// takes minutes.
//
// Reports counts, roles, ids by shape, lengths, fence languages and leak
// checks. No conversation text leaves the page. Attaches to the window on 9333
// and never closes it.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CLIO_PORT || 9333);
const REPO = path.resolve(__dirname, '..', '..');
const say = (s) => process.stdout.write(s + '\n');

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = null;
  for (const c of browser.contexts()) {
    for (const p of c.pages()) if (/chatgpt\.com\/(?:.*\/)?c\//.test(p.url())) { page = p; break; }
    if (page) break;
  }
  if (!page) { say('no ChatGPT conversation page on ' + PORT); return; }
  say(`attached: ${page.url()}`);

  const sources = ['extensions/src/selectors-chatgpt.js', 'extensions/src/content.js']
    .map((f) => fs.readFileSync(path.join(REPO, f), 'utf8'));

  // content.js registers a chrome.runtime listener at load. A page's own
  // `chrome` has no runtime, so give it one that does nothing.
  const scoped = `(function () {
    const chrome = { runtime: { onMessage: { addListener: function () {} }, sendMessage: function () {} } };
    ${sources[0]}
    ${sources[1]}
    window.__clioVerify = {
      validateSelectors, countMessages, findScrollContainer, extractConversation, isStreaming,
      getCapturedMessageEls, extractTurns, messageIdOf, chatgptRoleOf, queryMessages, isAgentReply
    };
  })();`;
  await page.evaluate((code) => { (0, eval)(code); }, scoped);
  say('injected selectors-chatgpt.js + content.js (scoped)');

  const pre = await page.evaluate(() => {
    const v = window.__clioVerify;
    const sc = v.findScrollContainer();
    return {
      streaming: v.isStreaming(),
      validation: v.validateSelectors(),
      count: v.countMessages(),
      scroller: sc ? `${sc.tagName.toLowerCase()}${sc.hasAttribute('data-app-action-timeline-scroll') ? '[data-app-action-timeline-scroll]' : ''}.${String(sc.className).split(/\s+/).slice(0, 2).join('.')}` : null,
      scrollerScrolls: sc ? sc.scrollHeight > sc.clientHeight : null
    };
  });
  say('');
  say('pre-flight');
  say(`  isStreaming:        ${pre.streaming}`);
  say(`  validateSelectors:  ${JSON.stringify(pre.validation)}`);
  say(`  countMessages:      ${pre.count}`);
  say(`  scroll container:   ${pre.scroller}  (scrolls: ${pre.scrollerScrolls})`);
  if (pre.streaming) {
    say('\nChatGPT is generating; extractConversation() would refuse. Wait for it to finish and re-run.');
    return;
  }

  // Start where a person starts: at the newest message. A previous run leaves
  // the page at the top, and a scroll-back that begins there never passes the
  // messages below it, which a virtualized list may have already evicted.
  await page.evaluate(() => {
    const sc = window.__clioVerify.findScrollContainer();
    if (sc) sc.scrollTop = sc.scrollHeight;
  });
  await new Promise((r) => setTimeout(r, 5000));

  say('\nrunning extractConversation() — this scrolls the page and can take minutes…');
  const t0 = Date.now();
  const r = await page.evaluate(async () => {
    const v = window.__clioVerify;
    const res = await v.extractConversation();
    if (!res.success) return { success: false, error: res.error };
    const turns = res.data.messages || [];

    // extractConversation() drops turns whose content came out blank (#208).
    // That is right for a genuinely empty shell and silent loss for a message
    // whose text the selectors could not reach, so every dropped one is
    // dissected: re-run the per-turn extraction over the same capture cache
    // and look at the clone each blank turn came from.
    const els = v.getCapturedMessageEls();
    const raw = await v.extractTurns();

    // A tool-activity line ("Inspected config.yaml") exported as reply text.
    // Checked against the activity elements in each turn's own clone, not
    // against a word list: a list fires on a reply that begins "Stopped." and
    // on a user message with a line starting "Verified", and did, twice.
    let activityLeaks = 0;
    for (const t of turns) {
      const el = t.id ? els.find((e) => v.messageIdOf(e) === t.id) : null;
      if (!el) continue;
      const captions = [...el.querySelectorAll('[class*="activity-header"]')]
        .map((h) => (h.textContent || '').trim()).filter(Boolean);
      if (captions.some((cap) => (t.content || '').includes(cap))) activityLeaks++;
    }
    const blanks = [];
    raw.forEach((t, i) => {
      const kept = (t.content && t.content.trim()) || (t.thinking && String(t.thinking).trim()) ||
        (t.attachments && t.attachments.length) || (t.toolUse && t.toolUse.length);
      if (kept) return;
      // Paired by id, not by position: the two lists stop lining up as soon
      // as extraction skips anything.
      const el = t.id ? els.find((e) => v.messageIdOf(e) === t.id) : null;
      const id = el ? v.messageIdOf(el) : null;
      const live = id ? v.queryMessages(document).find((x) => v.messageIdOf(x) === id) : null;
      const srHeading = el ? el.querySelector('h4.sr-only, [data-conversation-role]') : null;
      blanks.push({
        i,
        role: t.role,
        agentReply: el ? v.isAgentReply(el) : null,
        cloneText: el ? (el.textContent || '').length : null,
        srHeadingText: srHeading ? (srHeading.textContent || '').length : 0,
        markdownRoots: el ? el.querySelectorAll('[data-markdown-text-style]').length : null,
        markdownRootText: el ? [...el.querySelectorAll('[data-markdown-text-style]')].reduce((n, m) => n + (m.textContent || '').length, 0) : null,
        whitespacePreWrap: el ? el.querySelectorAll('.whitespace-pre-wrap').length : null,
        imgs: el ? el.querySelectorAll('img').length : null,
        codeBlocks: el ? el.querySelectorAll('[data-code-block]').length : null,
        buttons: el ? el.querySelectorAll('button').length : null,
        elements: el ? el.querySelectorAll('*').length : null,
        liveNow: !!live,
        liveText: live ? (live.textContent || '').length : null,
        // Classes and data-* names of the clone's direct children: enough to
        // name the kind of unit without reading its text.
        children: el ? [...el.children].map((c) => `${c.tagName.toLowerCase()}${[...c.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}]`).join('')}.${String(c.className).split(/\s+/).slice(0, 3).join('.')}`) : []
      });
    });
    const FENCE = /^```([^\n`]*)$/gm;
    const fences = [];
    let headerLeaks = 0, copyLeaks = 0, saidLeaks = 0;
    for (const t of turns) {
      const c = t.content || '';
      let m;
      FENCE.lastIndex = 0;
      while ((m = FENCE.exec(c)) !== null) if (m[1]) fences.push(m[1]);
      // A language label left standing on the line above its fence is the
      // header leak #399 guards against.
      const lines = c.split('\n');
      for (let i = 1; i < lines.length; i++) {
        if (/^```\S/.test(lines[i]) && /^[A-Za-z+#]{1,15}$/.test(lines[i - 1].trim())) headerLeaks++;
      }
      if (/Copy code|Enable word wrap/.test(c)) copyLeaks++;
      if (/^ChatGPT said:/m.test(c) || /^You said:/m.test(c)) saidLeaks++;
    }
    // The same reply exported twice under two ids — what a block caught before
    // its unit mounted would produce if the de-duplication failed.
    const seenText = new Map();
    let duplicateReplies = 0;
    for (const t of turns) {
      if (t.role !== 'assistant' || !(t.content || '').trim()) continue;
      if (seenText.has(t.content) && seenText.get(t.content) !== t.id) duplicateReplies++;
      else seenText.set(t.content, t.id);
    }
    const roles = turns.map((t) => (t.role === 'user' ? 'U' : t.role === 'assistant' ? 'A' : '?')).join('');
    const ids = turns.map((t) => t.id);
    return {
      success: true,
      turns: turns.length,
      roles,
      idsPresent: ids.filter(Boolean).length,
      idsUnique: new Set(ids.filter(Boolean)).size,
      emptyContent: turns.filter((t) => !(t.content || '').trim()).length,
      contentLengths: turns.map((t) => (t.content || '').length),
      fences,
      headerLeaks, copyLeaks, saidLeaks, activityLeaks, duplicateReplies,
      captured: els.length,
      agentReplies: els.filter((el) => v.isAgentReply(el)).length,
      rawTurns: raw.length,
      rawRoles: raw.map((t) => (t.role === 'user' ? 'U' : t.role === 'assistant' ? 'A' : '?')).join(''),
      blanks,
      metadata: {
        messageCount: res.data.metadata.messageCount,
        contentComplete: res.data.metadata.contentComplete,
        incompleteReasons: res.data.metadata.incompleteReasons,
        // What the page offered against what was taken (#324, #400).
        reasoningAffordances: res.data.metadata.reasoningAffordances,
        reasoningCaptured: res.data.metadata.reasoningCaptured,
        scrollInfo: res.data.metadata.scrollInfo,
        orderInfo: res.data.metadata.orderInfo
      },
      warnings: res.warnings
    };
  });
  say(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
  say('');
  if (!r.success) { say(`FAILED: ${r.error}`); process.exitCode = 1; return; }
  say(`turns:              ${r.turns}`);
  say(`roles in order:     ${r.roles}`);
  say(`ids present/unique: ${r.idsPresent}/${r.idsUnique}`);
  say(`empty content:      ${r.emptyContent}`);
  say(`content lengths:    ${r.contentLengths.join(' ')}`);
  say(`code fences:        ${r.fences.length}  languages: ${JSON.stringify(r.fences)}`);
  say(`leaks — header label above a fence: ${r.headerLeaks}   copy/wrap captions: ${r.copyLeaks}   "said:" headings: ${r.saidLeaks}   activity captions: ${r.activityLeaks}`);
  say(`duplicate replies (same text, two ids): ${r.duplicateReplies}`);
  say(`metadata:           ${JSON.stringify(r.metadata)}`);
  say(`warnings:           ${JSON.stringify(r.warnings)}`);
  say('');
  say(`captured messages:  ${r.captured} (of which unit-less replies: ${r.agentReplies})   raw turns: ${r.rawTurns}   dropped as blank: ${r.blanks.length}`);
  say(`raw roles in order: ${r.rawRoles}`);
  for (const b of r.blanks) {
    say(`  blank #${b.i} ${b.role}${b.agentReply ? ' (unit-less reply)' : ''}: clone text ${b.cloneText} (sr heading ${b.srHeadingText})  markdownRoots ${b.markdownRoots} (text ${b.markdownRootText})  wpw ${b.whitespacePreWrap}  img ${b.imgs}  code ${b.codeBlocks}  buttons ${b.buttons}  elements ${b.elements}  live now: ${b.liveNow}${b.liveNow ? ` (text ${b.liveText})` : ''}`);
    say(`      children: ${b.children.join(' | ')}`);
  }
  // No browser.close() — the operator owns that window.
}

main().catch((e) => {
  say('VERIFY ERROR: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
}).finally(() => process.exit(process.exitCode || 0));

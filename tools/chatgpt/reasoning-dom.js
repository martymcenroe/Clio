// Discovery logic for ChatGPT reasoning affordances, kept separate from the
// probe that drives it (#317).
//
// It lives in its own file for two reasons. It is injected into the page as
// source text by probe-reasoning.js, the same way sweep-account.js injects
// content.js, so it must not close over anything in Node. And being pure, it can
// be exercised in jsdom, which the probe itself cannot.
//
// It DISCOVERS, it does not decide. Nothing here asserts what the selector
// should be; it reports what is actually on the page so the selector can be read
// off real markup rather than guessed. Choosing the selector is #316.
//
// Never returns conversation text. Lengths, tags, classes and attributes only:
// output from this is written to disk and pasted into issues, and the
// conversations are the operator's (#250).

(function (root) {
  'use strict';

  // The visible label ChatGPT puts on a reasoning affordance. Deliberately
  // loose: the wording has changed across models ("Reasoned about X for Ys",
  // "Thought for Ys") and will change again. A candidate matching this is a
  // starting point for inspection, never a confirmed hit.
  var LABEL = /^\s*(reasoned|thought|thinking|reasoning)\b/i;

  // How far up to walk when describing where a candidate sits. Enough to reach
  // the message container without dumping the whole document.
  var CHAIN_DEPTH = 6;

  /**
   * Describe one element structurally. Never its text.
   */
  function describe(el) {
    if (!el || !el.tagName) return null;
    var cs = null;
    try { cs = el.ownerDocument.defaultView.getComputedStyle(el); } catch (e) { /* jsdom */ }
    var attrs = {};
    for (var i = 0; i < (el.attributes || []).length; i++) {
      var a = el.attributes[i];
      // class is reported separately; style is noise at this altitude.
      if (a.name === 'class' || a.name === 'style') continue;
      attrs[a.name] = a.value.length > 80 ? a.value.slice(0, 80) + '…' : a.value;
    }
    return {
      tag: el.tagName.toLowerCase(),
      classes: (el.getAttribute && el.getAttribute('class')) || '',
      attrs: attrs,
      overflowY: cs ? cs.overflowY : null,
      maxHeight: cs ? cs.maxHeight : null,
      scrollHeight: el.scrollHeight || 0,
      clientHeight: el.clientHeight || 0,
      // The collapse question in one number. A clipped element is taller than
      // its box; if the text is already in the DOM this is where it shows.
      clipped: (el.scrollHeight || 0) > (el.clientHeight || 0),
      textLength: (el.textContent || '').length
    };
  }

  /**
   * The chain from an element up towards the message container.
   */
  function ancestorChain(el, depth) {
    var out = [];
    var cur = el;
    var n = depth || CHAIN_DEPTH;
    while (cur && out.length < n) {
      out.push(describe(cur));
      cur = cur.parentElement;
    }
    return out;
  }

  /**
   * Is this element plausibly the clickable affordance rather than prose that
   * happens to begin with the word "Thinking"?
   */
  function isClickable(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName.toLowerCase() === 'button') return true;
    var role = el.getAttribute && el.getAttribute('role');
    if (role === 'button') return true;
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) return true;
    return false;
  }

  /**
   * Find every plausible reasoning affordance in a document.
   *
   * Two independent routes, because either may be the one that survives the
   * next redesign: the visible label, and any test id or aria attribute naming
   * reasoning. A candidate found by both is the strongest signal available
   * without clicking it.
   *
   * @param {Document} doc
   * @param {string} messageSelector - how assistant turns are identified
   * @returns {{assistantTurns: number, candidates: Array<Object>}}
   */
  function findReasoningCandidates(doc, messageSelector) {
    var sel = messageSelector || '[data-message-author-role="assistant"]';
    var turns = doc.querySelectorAll(sel);
    var seen = [];
    var candidates = [];

    function add(el, how) {
      if (!el || seen.indexOf(el) !== -1) return;
      seen.push(el);
      var turn = el.closest ? el.closest(sel) : null;
      candidates.push({
        foundBy: how,
        clickable: isClickable(el),
        // Where the affordance sits relative to the assistant turn, which is
        // what decides whether a selector can be scoped to the message.
        insideAssistantTurn: !!turn,
        label: (el.textContent || '').slice(0, 40).replace(/\s+/g, ' ').trim(),
        chain: ancestorChain(el)
      });
    }

    // Route 1: anything whose own label reads like a reasoning affordance.
    var all = doc.querySelectorAll('button, [role="button"], [aria-expanded]');
    for (var i = 0; i < all.length; i++) {
      if (LABEL.test(all[i].textContent || '')) add(all[i], 'label');
    }

    // Route 2: anything self-identifying through an attribute.
    var attrHits = doc.querySelectorAll(
      '[data-testid*="reason" i], [data-testid*="think" i], ' +
      '[aria-label*="reason" i], [aria-label*="think" i]');
    for (var j = 0; j < attrHits.length; j++) add(attrHits[j], 'attribute');

    return { assistantTurns: turns.length, candidates: candidates };
  }

  var api = {
    LABEL: LABEL,
    describe: describe,
    ancestorChain: ancestorChain,
    isClickable: isClickable,
    findReasoningCandidates: findReasoningCandidates
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClioReasoningDom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

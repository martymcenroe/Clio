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
// A DISCOVERY INSTRUMENT MUST BE OVER-INCLUSIVE (#321). Its output is a
// candidate list a person reads, so a false positive costs a glance and a false
// negative costs the whole answer -- silently, and dressed as a result. The
// first version of this file matched an enumerated verb list,
// reasoned|thought|thinking|reasoning, copied from a comment in
// selectors-chatgpt.js. The operator then opened a conversation whose affordance
// reads "Worked for 5m 34s". It matched none of them, and the probe would have
// printed "no affordance found" about a page that plainly had one.
//
// Hence four routes below, additive rather than exclusive, ending in one that
// does not depend on predicting anything.
//
// Never returns conversation text. Lengths, tags, classes and attributes only:
// output from this is written to disk and pasted into issues, and the
// conversations are the operator's (#250).

(function (root) {
  'use strict';

  // ROUTE 1 -- the duration. Every wording seen so far ends in an elapsed time:
  // "Reasoned about X for 12 seconds", "Thought for 8s", "Worked for 5m 34s".
  // The affordance exists in order to report how long it took, so the duration
  // is the most durable thing about it, and far more durable than the verb,
  // which has already changed three times.
  var DURATION = /\bfor\s+\d+\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/i;

  // ROUTE 2 -- the verb, widened. Cheap, and independent of route 1 for a
  // wording that carries no duration ("Thinking...").
  var LABEL = /^\s*(reasoned|reasoning|thought|thinking|worked|working|finished|pondered)\b/i;

  // Labels that are certainly NOT the reasoning affordance. Deliberately short:
  // this suppresses noise in the BACKSTOP only, and anything it wrongly excludes
  // becomes a false negative, so it earns entries only for controls that appear
  // on every single turn.
  var KNOWN_CONTROLS = /^\s*(copy|copied|edit|share|download|read aloud|good response|bad response|regenerate|try again|more actions|switch model)\s*$/i;

  // How far up to walk when describing where a candidate sits. Enough to reach
  // the message container without dumping the whole document.
  var CHAIN_DEPTH = 6;
  var BACKSTOP_CAP = 25;

  function clickableSelector() {
    return 'button, [role="button"], [aria-expanded], summary';
  }

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
    var tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') return true;
    var role = el.getAttribute && el.getAttribute('role');
    if (role === 'button') return true;
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) return true;
    return false;
  }

  /**
   * Which routes match this element? Returns an array, possibly empty.
   */
  function routesFor(el) {
    var text = el.textContent || '';
    var hits = [];
    if (DURATION.test(text)) hits.push('duration');
    if (LABEL.test(text)) hits.push('label');
    var testid = (el.getAttribute && (el.getAttribute('data-testid') || '')) || '';
    var aria = (el.getAttribute && (el.getAttribute('aria-label') || '')) || '';
    if (/reason|think|thought/i.test(testid + ' ' + aria)) hits.push('attribute');
    return hits;
  }

  /**
   * The candidate ELEMENTS, in a stable order.
   *
   * Split out from findReasoningCandidates so the probe can click candidate N
   * and be certain it is the same element the report calls N. Two separate
   * enumerations would be two things to keep in step, and they would drift --
   * the first version of the probe re-derived the list by hand at click time
   * with a different filter, which was only correct by accident.
   *
   * Returns live elements, so it is useful only inside the page.
   */
  function candidateElements(doc, messageSelector) {
    var sel = messageSelector || '[data-message-author-role="assistant"]';
    var out = [];
    var seen = [];

    // Routes 1 and 2 over anything clickable, anywhere on the page: the
    // affordance is not necessarily inside the assistant turn, and where it
    // sits is part of what the probe is trying to find out.
    var clickables = doc.querySelectorAll(clickableSelector());
    for (var i = 0; i < clickables.length; i++) {
      var hits = routesFor(clickables[i]);
      if (hits.length && seen.indexOf(clickables[i]) === -1) {
        seen.push(clickables[i]);
        out.push({ el: clickables[i], foundBy: hits });
      }
    }

    // Route 3 over anything self-identifying, clickable or not, since the text
    // may live in a container that is not itself the button.
    var attrHits = doc.querySelectorAll(
      '[data-testid*="reason" i], [data-testid*="think" i], [data-testid*="thought" i], ' +
      '[aria-label*="reason" i], [aria-label*="think" i], [aria-label*="thought" i]');
    for (var j = 0; j < attrHits.length; j++) {
      if (seen.indexOf(attrHits[j]) === -1) {
        seen.push(attrHits[j]);
        out.push({ el: attrHits[j], foundBy: ['attribute'] });
      }
    }
    return out;
  }

  /**
   * Find every plausible reasoning affordance in a document.
   *
   * @param {Document} doc
   * @param {string} messageSelector - how assistant turns are identified
   * @returns {{assistantTurns: number, candidates: Array, otherClickables: Array,
   *            otherClickablesTotal: number}}
   */
  function findReasoningCandidates(doc, messageSelector) {
    var sel = messageSelector || '[data-message-author-role="assistant"]';
    var turns = doc.querySelectorAll(sel);
    var candidates = [];
    var others = [];
    var othersTotal = 0;
    var seen = [];

    var found = candidateElements(doc, sel);
    for (var f = 0; f < found.length; f++) {
      var cel = found[f].el;
      seen.push(cel);
      var turn = cel.closest ? cel.closest(sel) : null;
      candidates.push({
        foundBy: found[f].foundBy,
        clickable: isClickable(cel),
        // Where the affordance sits relative to the assistant turn, which is
        // what decides whether a selector can be scoped to the message.
        insideAssistantTurn: !!turn,
        label: (cel.textContent || '').slice(0, 60).replace(/\s+/g, ' ').trim(),
        chain: ancestorChain(cel)
      });
    }

    // ROUTE 4 -- the backstop, and the point of this rewrite. Every remaining
    // clickable inside an assistant turn, minus the controls that appear on
    // every turn. If the wording changes again to something nobody predicted, it
    // lands here instead of vanishing.
    for (var k = 0; k < turns.length; k++) {
      var inner = turns[k].querySelectorAll(clickableSelector());
      for (var m = 0; m < inner.length; m++) {
        var el = inner[m];
        if (seen.indexOf(el) !== -1) continue;
        var label = (el.textContent || '').slice(0, 60).replace(/\s+/g, ' ').trim();
        if (KNOWN_CONTROLS.test(label)) continue;
        othersTotal++;
        if (others.length >= BACKSTOP_CAP) continue;
        seen.push(el);
        others.push({
          label: label,
          clickable: isClickable(el),
          chain: ancestorChain(el, 3)
        });
      }
    }

    return {
      assistantTurns: turns.length,
      candidates: candidates,
      otherClickables: others,
      otherClickablesTotal: othersTotal
    };
  }

  var api = {
    DURATION: DURATION,
    LABEL: LABEL,
    KNOWN_CONTROLS: KNOWN_CONTROLS,
    BACKSTOP_CAP: BACKSTOP_CAP,
    describe: describe,
    ancestorChain: ancestorChain,
    isClickable: isClickable,
    routesFor: routesFor,
    clickableSelector: clickableSelector,
    candidateElements: candidateElements,
    findReasoningCandidates: findReasoningCandidates
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClioReasoningDom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * A capture that drops reasoning must say so (#324).
 *
 * On ChatGPT `thinkingToggle` and `thinkingContent` are both null, so
 * `expandAllContent()` clicks nothing and every message ships an empty
 * `thinking` field — across 5,644 captured messages, not one had any (#316).
 * That was silent: a conversation whose reasoning was dropped looked identical
 * to one that never had any, inside a capture reporting `contentComplete: true`.
 *
 * These tests pin the DETECTION, which is ours. They do not pin ChatGPT's
 * markup, which is not — the affordance wording is read off the live page by
 * `tools/chatgpt/probe-reasoning.js`, and the selector work stays with #316. The
 * one label here that is not invented is "Worked for 5m 34s", which the operator
 * read off a real conversation.
 *
 * The property that matters most is the negative one: this check appears in
 * every export, so a false positive marks a clean capture incomplete. That is
 * exactly the failure `contentComplete` was created to escape from
 * `partialSuccess` (#280), so the no-false-alarm cases below are the point of
 * the file, not padding.
 */

const {
  isReasoningAffordance,
  countReasoningAffordances,
  REASONING_DURATION
} = require('../extensions/src/content.js');

// content.js reads the site's selectors off a global.
beforeEach(() => {
  global.SELECTORS = { assistantMessage: '[data-message-author-role="assistant"]' };
  document.body.innerHTML = '';
});

const turn = inner => `<div data-message-author-role="assistant">${inner}</div>`;
const el = html => { document.body.innerHTML = html; return document.body.firstElementChild; };

describe('REASONING_DURATION', () => {
  test('matches every affordance wording seen so far', () => {
    for (const s of ['Worked for 5m 34s', 'Thought for 8s',
                     'Reasoned about physics for 12 seconds', 'Pondered for 1h 3m']) {
      expect(REASONING_DURATION.test(s)).toBe(true);
    }
  });

  test('does not fire on "for" without a duration', () => {
    for (const s of ['Thanks for the answer', 'for example', 'waited for a while']) {
      expect(REASONING_DURATION.test(s)).toBe(false);
    }
  });
});

describe('isReasoningAffordance', () => {
  test('accepts the live wording that broke the probe pattern', () => {
    expect(isReasoningAffordance(el('<button>Worked for 5m 34s</button>'))).toBe(true);
  });

  test('accepts a self-identifying attribute even with unknown wording', () => {
    expect(isReasoningAffordance(el('<button data-testid="reasoning-x">Deliberated</button>'))).toBe(true);
    expect(isReasoningAffordance(el('<button aria-label="Show thinking">x</button>'))).toBe(true);
  });

  test('is NARROWER than the probe: a bare verb is not enough', () => {
    // tools/chatgpt/reasoning-dom.js matches this, on purpose. This must not:
    // it runs in every export, where a false positive marks a clean capture
    // incomplete.
    expect(isReasoningAffordance(el('<button>Thinking</button>'))).toBe(false);
    expect(isReasoningAffordance(el('<button>Worked</button>'))).toBe(false);
  });

  test('does not fire on ordinary per-turn controls', () => {
    for (const label of ['Copy', 'Edit', 'Read aloud', 'Regenerate', 'Share']) {
      expect(isReasoningAffordance(el(`<button>${label}</button>`))).toBe(false);
    }
  });

  test('tolerates a null or attribute-less element', () => {
    expect(isReasoningAffordance(null)).toBe(false);
    expect(isReasoningAffordance({})).toBe(false);
  });
});

describe('countReasoningAffordances', () => {
  test('counts turns that offer reasoning', () => {
    document.body.innerHTML =
      turn('<button>Worked for 5m 34s</button>') +
      turn('<button>Copy</button>') +
      turn('<button>Thought for 8s</button>');
    expect(countReasoningAffordances()).toBe(2);
  });

  test('counts a turn once even when it carries several matching controls', () => {
    // Otherwise the number could exceed the message count it is compared
    // against, and the shortfall would be nonsense.
    document.body.innerHTML = turn(`
      <button>Worked for 5m 34s</button>
      <button data-testid="reasoning-detail">Thought for 2s</button>`);
    expect(countReasoningAffordances()).toBe(1);
  });

  test('is zero on a conversation with no reasoning at all', () => {
    document.body.innerHTML = turn('<button>Copy</button>') + turn('<div>answer</div>');
    expect(countReasoningAffordances()).toBe(0);
  });

  test('ignores controls outside assistant turns', () => {
    document.body.innerHTML =
      '<button>Worked for 5m 34s</button>' + turn('<div>answer</div>');
    expect(countReasoningAffordances()).toBe(0);
  });

  test('returns zero rather than throwing when the site has no selector', () => {
    global.SELECTORS = {};
    document.body.innerHTML = turn('<button>Worked for 5m 34s</button>');
    expect(countReasoningAffordances()).toBe(0);
  });
});

describe('the shortfall arithmetic', () => {
  // The extraction compares countReasoningAffordances() against the number of
  // turns carrying non-empty thinking. These pin the comparison's behaviour at
  // the boundaries without driving the whole extraction.
  const shortfall = (affordances, turns) => {
    const captured = turns.filter(t => t.thinking && String(t.thinking).trim()).length;
    return affordances > captured ? affordances - captured : 0;
  };

  test('reports the gap when the page offers reasoning and we captured none', () => {
    expect(shortfall(3, [{ thinking: null }, { thinking: null }, { thinking: '' }])).toBe(3);
  });

  test('stays silent once capture catches up — self-correcting', () => {
    // When the #316 selectors land, this check stops firing on its own.
    expect(shortfall(2, [{ thinking: 'because...' }, { thinking: 'and then...' }])).toBe(0);
  });

  test('treats whitespace-only thinking as not captured', () => {
    expect(shortfall(1, [{ thinking: '   \n ' }])).toBe(1);
  });

  test('never goes negative when more was captured than detected', () => {
    expect(shortfall(1, [{ thinking: 'a' }, { thinking: 'b' }])).toBe(0);
  });
});

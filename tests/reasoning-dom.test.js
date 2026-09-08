/**
 * Tests for the reasoning-affordance DISCOVERY logic (#317, corrected in #321).
 *
 * A deliberate limit on what these prove. The markup below is illustrative: it
 * exercises the traversal, the discovery routes, the clickability test and the
 * no-text guarantee. It does NOT establish what ChatGPT's reasoning markup
 * actually looks like, and a passing suite here is not evidence that any
 * selector is correct — that answer only comes from probe-reasoning.js against
 * the live page, and it lands in #316.
 *
 * This is the distinction the verification strategy doc opens with: a test
 * asserting against DOM we invented proves the parser matches our assumption,
 * not the site. Two wrong selectors have shipped on exactly that confusion
 * (PR #26, PR #40). So what is tested here is the part that is ours — the
 * search — and not the part that is theirs.
 *
 * The one label below that is NOT invented is "Worked for 5m 34s". The operator
 * read it off a live conversation, and it is the wording that broke the first
 * version of this file. It gets a regression test of its own.
 */

const {
  DURATION,
  LABEL,
  KNOWN_CONTROLS,
  BACKSTOP_CAP,
  describe: describeEl,
  ancestorChain,
  isClickable,
  routesFor,
  candidateElements,
  findReasoningCandidates
} = require('../tools/chatgpt/reasoning-dom.js');

function build(html) {
  document.body.innerHTML = html;
  return document;
}
const turn = inner => `<div data-message-author-role="assistant">${inner}</div>`;

describe('the wording that broke the first version', () => {
  test('"Worked for 5m 34s" is found — the #321 regression', () => {
    const doc = build(turn('<button>Worked for 5m 34s</button><div class="markdown">a</div>'));
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].foundBy).toEqual(expect.arrayContaining(['duration', 'label']));
  });

  test('the old verb-only pattern would have missed it', () => {
    // Pinning the actual defect: the original LABEL had no "worked".
    expect(/^\s*(reasoned|thought|thinking|reasoning)\b/i.test('Worked for 5m 34s')).toBe(false);
    // And the duration route catches it independently of any verb at all.
    expect(DURATION.test('Worked for 5m 34s')).toBe(true);
  });
});

describe('DURATION route', () => {
  test('matches every elapsed-time wording seen so far', () => {
    expect(DURATION.test('Worked for 5m 34s')).toBe(true);
    expect(DURATION.test('Thought for 8s')).toBe(true);
    expect(DURATION.test('Reasoned about physics for 12 seconds')).toBe(true);
    expect(DURATION.test('Pondered for 1h 3m')).toBe(true);
    expect(DURATION.test('Deliberated for 45 min')).toBe(true);
  });

  test('does not fire on prose that says "for" without a duration', () => {
    expect(DURATION.test('Thanks for the answer')).toBe(false);
    expect(DURATION.test('for example')).toBe(false);
    expect(DURATION.test('waited for a while')).toBe(false);
  });

  test('catches a verb nobody has predicted, as long as it reports a time', () => {
    expect(DURATION.test('Cogitated for 9s')).toBe(true);
    expect(LABEL.test('Cogitated for 9s')).toBe(false);
  });
});

describe('LABEL route', () => {
  test('covers the verbs seen so far, at the start only', () => {
    for (const s of ['Reasoned about it', 'Thought for 8s', 'Thinking', 'Worked for 5m',
                     'Working on it', 'Finished thinking', 'reasoning']) {
      expect(LABEL.test(s)).toBe(true);
    }
  });

  test('does not match prose that merely mentions the words', () => {
    expect(LABEL.test('I have thought about this')).toBe(false);
    expect(LABEL.test('the reasoning is unclear')).toBe(false);
  });
});

describe('routesFor', () => {
  test('reports every route that matches, not just the first', () => {
    const doc = build('<button data-testid="reasoning-x">Thought for 8s</button>');
    expect(routesFor(doc.querySelector('button')).sort())
      .toEqual(['attribute', 'duration', 'label']);
  });

  test('returns an empty array when nothing matches', () => {
    const doc = build('<button>Copy</button>');
    expect(routesFor(doc.querySelector('button'))).toEqual([]);
  });
});

describe('isClickable', () => {
  test('accepts button, summary, role=button and aria-expanded', () => {
    const doc = build(`
      <button id="a">x</button><summary id="b">x</summary>
      <div id="c" role="button">x</div><div id="d" aria-expanded="false">x</div>
      <div id="e">x</div>`);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(isClickable(doc.getElementById(id))).toBe(true);
    }
    expect(isClickable(doc.getElementById('e'))).toBe(false);
  });
});

describe('describe', () => {
  test('reports structure and never returns the text itself', () => {
    const doc = build('<div class="x y" data-testid="t" title="hello">secret text</div>');
    const d = describeEl(doc.querySelector('div'));
    expect(d.tag).toBe('div');
    expect(d.classes).toBe('x y');
    expect(d.attrs['data-testid']).toBe('t');
    expect(d.textLength).toBe('secret text'.length);
    expect(JSON.stringify(d)).not.toContain('secret text');
  });

  test('omits class and style from attrs, since class is reported separately', () => {
    const doc = build('<div class="x" style="color:red" id="k">t</div>');
    const d = describeEl(doc.querySelector('div'));
    expect(d.attrs.class).toBeUndefined();
    expect(d.attrs.style).toBeUndefined();
    expect(d.attrs.id).toBe('k');
  });

  test('truncates a long attribute value rather than dumping it', () => {
    const doc = build(`<div aria-label="${'z'.repeat(200)}">t</div>`);
    const d = describeEl(doc.querySelector('div'));
    expect(d.attrs['aria-label'].length).toBeLessThanOrEqual(81);
    expect(d.attrs['aria-label'].endsWith('…')).toBe(true);
  });
});

describe('ancestorChain', () => {
  test('walks upward and stops at the requested depth', () => {
    build('<div id="g"><div id="p"><span id="c">t</span></div></div>');
    const chain = ancestorChain(document.getElementById('c'), 3);
    expect(chain.map(d => d.tag)).toEqual(['span', 'div', 'div']);
  });

  test('stops at the root rather than running off the top', () => {
    build('<div id="only">t</div>');
    const chain = ancestorChain(document.getElementById('only'), 50);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length).toBeLessThan(50);
  });
});

describe('candidateElements', () => {
  test('is the same ordering the report uses, so click indexes cannot drift', () => {
    const doc = build(turn(`
      <button>Thought for 8s</button>
      <button data-testid="reasoning-b">something</button>`));
    const els = candidateElements(doc);
    const rep = findReasoningCandidates(doc);
    expect(els).toHaveLength(rep.candidates.length);
    els.forEach((e, i) => {
      expect((e.el.textContent || '').slice(0, 60).replace(/\s+/g, ' ').trim())
        .toBe(rep.candidates[i].label);
    });
  });

  test('never returns the same element twice when routes overlap', () => {
    const doc = build(turn('<button data-testid="reasoning">Thought for 4s</button>'));
    expect(candidateElements(doc)).toHaveLength(1);
  });
});

describe('findReasoningCandidates', () => {
  test('counts assistant turns even when nothing is found', () => {
    const doc = build(turn('<div class="markdown">hi</div>') + turn('<div class="markdown">hi</div>'));
    const r = findReasoningCandidates(doc);
    expect(r.assistantTurns).toBe(2);
    expect(r.candidates).toHaveLength(0);
  });

  test('reports an affordance that sits OUTSIDE the assistant turn', () => {
    const doc = build('<button>Thought for 4s</button>' + turn('<div class="markdown">a</div>'));
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].insideAssistantTurn).toBe(false);
  });

  test('ignores prose in the answer that merely mentions reasoning', () => {
    const doc = build(turn('<div class="markdown">My reasoning was that I thought a while.</div>'));
    expect(findReasoningCandidates(doc).candidates).toHaveLength(0);
  });

  test('honours a caller-supplied message selector', () => {
    const doc = build('<article class="turn"><button>Thought for 1s</button></article>');
    const r = findReasoningCandidates(doc, 'article.turn');
    expect(r.assistantTurns).toBe(1);
    expect(r.candidates[0].insideAssistantTurn).toBe(true);
  });

  test('never puts conversation text in the result', () => {
    const doc = build(turn(`
      <button>Reasoned for 2s</button>
      <div class="markdown">CONFIDENTIAL_ANSWER_BODY</div>`));
    expect(JSON.stringify(findReasoningCandidates(doc)))
      .not.toContain('CONFIDENTIAL_ANSWER_BODY');
  });
});

describe('the backstop — route 4', () => {
  test('surfaces an unmatched clickable so an unpredicted wording cannot vanish', () => {
    const doc = build(turn('<button>Ruminated briefly</button><div class="markdown">a</div>'));
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(0);
    expect(r.otherClickables).toHaveLength(1);
    expect(r.otherClickables[0].label).toBe('Ruminated briefly');
  });

  test('excludes the per-turn controls that would otherwise drown it', () => {
    const doc = build(turn(`
      <button>Copy</button><button>Edit</button><button>Read aloud</button>
      <button>Ruminated briefly</button>`));
    const r = findReasoningCandidates(doc);
    expect(r.otherClickables.map(o => o.label)).toEqual(['Ruminated briefly']);
  });

  test('does not repeat anything already reported as a candidate', () => {
    const doc = build(turn('<button>Worked for 5m 34s</button><button>Copy</button>'));
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
    expect(r.otherClickables).toHaveLength(0);
  });

  test('caps the listing but reports the true total', () => {
    const many = Array.from({ length: BACKSTOP_CAP + 7 },
      (_, i) => `<button>odd control ${i}</button>`).join('');
    const r = findReasoningCandidates(build(turn(many)));
    expect(r.otherClickables).toHaveLength(BACKSTOP_CAP);
    expect(r.otherClickablesTotal).toBe(BACKSTOP_CAP + 7);
  });

  test('only looks inside assistant turns, not across the whole page', () => {
    const doc = build('<button>sidebar thing</button>' + turn('<div class="markdown">a</div>'));
    expect(findReasoningCandidates(doc).otherClickables).toHaveLength(0);
  });

  test('never puts conversation text in the backstop either', () => {
    const doc = build(turn(`
      <button>Ruminated briefly</button>
      <div class="markdown">CONFIDENTIAL_ANSWER_BODY</div>`));
    expect(JSON.stringify(findReasoningCandidates(doc).otherClickables))
      .not.toContain('CONFIDENTIAL_ANSWER_BODY');
  });
});

describe('KNOWN_CONTROLS', () => {
  test('matches only an exact control label, never a longer string containing one', () => {
    expect(KNOWN_CONTROLS.test('Copy')).toBe(true);
    expect(KNOWN_CONTROLS.test('copied')).toBe(true);
    // The hazard: a suppression list that swallows the thing being looked for.
    expect(KNOWN_CONTROLS.test('Copy of the reasoning, worked for 5m')).toBe(false);
    expect(KNOWN_CONTROLS.test('Worked for 5m 34s')).toBe(false);
  });
});

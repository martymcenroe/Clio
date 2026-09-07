/**
 * Tests for the reasoning-affordance DISCOVERY logic (#317).
 *
 * A deliberate limit on what these prove. The markup below is illustrative: it
 * exercises the traversal, the two discovery routes, the clickability test and
 * the no-text guarantee. It does NOT establish what ChatGPT's reasoning markup
 * actually looks like, and a passing suite here is not evidence that any
 * selector is correct — that answer only comes from probe-reasoning.js against
 * the live page, and it lands in #316.
 *
 * This is the distinction the verification strategy doc opens with: a test
 * asserting against DOM we invented proves the parser matches our assumption,
 * not the site. Two wrong selectors have shipped on exactly that confusion
 * (PR #26, PR #40). So what is tested here is the part that is ours — the
 * search — and not the part that is theirs.
 */

const {
  LABEL,
  describe: describeEl,
  ancestorChain,
  isClickable,
  findReasoningCandidates
} = require('../tools/chatgpt/reasoning-dom.js');

function build(html) {
  document.body.innerHTML = html;
  return document;
}

describe('LABEL', () => {
  test('matches the wordings ChatGPT has used, at the start only', () => {
    expect(LABEL.test('Reasoned about physics for 12 seconds')).toBe(true);
    expect(LABEL.test('Thought for 8s')).toBe(true);
    expect(LABEL.test('Thinking')).toBe(true);
    expect(LABEL.test('  reasoning')).toBe(true);
  });

  test('does not match prose that merely mentions the words', () => {
    expect(LABEL.test('I have thought about this')).toBe(false);
    expect(LABEL.test('the reasoning is unclear')).toBe(false);
  });
});

describe('isClickable', () => {
  test('accepts a button, role=button and aria-expanded', () => {
    const doc = build(`
      <button id="a">Thought for 3s</button>
      <div id="b" role="button">Thought for 3s</div>
      <div id="c" aria-expanded="false">Thought for 3s</div>
      <div id="d">Thought for 3s</div>`);
    expect(isClickable(doc.getElementById('a'))).toBe(true);
    expect(isClickable(doc.getElementById('b'))).toBe(true);
    expect(isClickable(doc.getElementById('c'))).toBe(true);
    expect(isClickable(doc.getElementById('d'))).toBe(false);
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
    // The whole record, serialized, must not carry the content.
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
  test('walks upward from the element and stops at the requested depth', () => {
    build('<div id="g"><div id="p"><span id="c">t</span></div></div>');
    const chain = ancestorChain(document.getElementById('c'), 3);
    expect(chain.map(d => d.tag)).toEqual(['span', 'div', 'div']);
    expect(chain).toHaveLength(3);
  });

  test('stops at the root rather than running off the top', () => {
    build('<div id="only">t</div>');
    const chain = ancestorChain(document.getElementById('only'), 50);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length).toBeLessThan(50);
  });
});

describe('findReasoningCandidates', () => {
  test('counts assistant turns even when nothing is found', () => {
    const doc = build(`
      <div data-message-author-role="assistant"><div class="markdown">hi</div></div>
      <div data-message-author-role="assistant"><div class="markdown">hi</div></div>`);
    const r = findReasoningCandidates(doc);
    expect(r.assistantTurns).toBe(2);
    expect(r.candidates).toHaveLength(0);
  });

  test('finds an affordance by its label and locates it inside the turn', () => {
    const doc = build(`
      <div data-message-author-role="assistant">
        <button>Reasoned about it for 5 seconds</button>
        <div class="markdown">answer</div>
      </div>`);
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].foundBy).toBe('label');
    expect(r.candidates[0].clickable).toBe(true);
    expect(r.candidates[0].insideAssistantTurn).toBe(true);
  });

  test('finds an affordance by attribute when the wording has changed', () => {
    const doc = build(`
      <div data-message-author-role="assistant">
        <div data-testid="reasoning-toggle">Deliberated briefly</div>
        <div class="markdown">answer</div>
      </div>`);
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].foundBy).toBe('attribute');
  });

  test('reports an affordance that sits OUTSIDE the assistant turn', () => {
    // This is the case that decides whether a selector can be scoped to the
    // message at all, so it has to be visible in the output rather than
    // silently dropped.
    const doc = build(`
      <button>Thought for 4s</button>
      <div data-message-author-role="assistant"><div class="markdown">answer</div></div>`);
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].insideAssistantTurn).toBe(false);
  });

  test('does not report the same element twice when both routes hit it', () => {
    const doc = build(`
      <div data-message-author-role="assistant">
        <button data-testid="reasoning">Thought for 4s</button>
      </div>`);
    const r = findReasoningCandidates(doc);
    expect(r.candidates).toHaveLength(1);
  });

  test('ignores prose in the answer that merely mentions reasoning', () => {
    const doc = build(`
      <div data-message-author-role="assistant">
        <div class="markdown">My reasoning was that I thought for a while.</div>
      </div>`);
    expect(findReasoningCandidates(doc).candidates).toHaveLength(0);
  });

  test('never puts conversation text in the result', () => {
    const doc = build(`
      <div data-message-author-role="assistant">
        <button>Reasoned for 2s</button>
        <div class="markdown">CONFIDENTIAL_ANSWER_BODY</div>
      </div>`);
    const r = findReasoningCandidates(doc);
    expect(JSON.stringify(r)).not.toContain('CONFIDENTIAL_ANSWER_BODY');
  });

  test('honours a caller-supplied message selector', () => {
    const doc = build(`
      <article class="turn"><button>Thought for 1s</button></article>`);
    const r = findReasoningCandidates(doc, 'article.turn');
    expect(r.assistantTurns).toBe(1);
    expect(r.candidates[0].insideAssistantTurn).toBe(true);
  });
});

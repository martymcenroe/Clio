/**
 * Code-block language detection (#263).
 *
 * Reading only the header strip labelled 73 of 636 blocks on a real
 * conversation. These pin the cases that were being missed, and the case that
 * was being got wrong.
 */

const {
  detectCodeLanguage,
  sniffCodeLanguage,
  outermostPre,
  extractTextContent
} = require('../extensions/src/content.js');
const { SELECTORS } = require('../extensions/src/selectors-chatgpt.js');

global.SELECTORS = SELECTORS;

function block(html) {
  document.body.innerHTML = html;
  const pre = document.querySelector('pre');
  const code = pre.querySelector('code') || pre;
  return { pre, code };
}

describe('detectCodeLanguage (#263)', () => {
  test('reads the highlighter class on <code>', () => {
    const { pre, code } = block('<pre><code class="language-python">x = 1</code></pre>');
    expect(detectCodeLanguage(code, pre)).toBe('python');
  });

  test('accepts the lang- prefix too', () => {
    const { pre, code } = block('<pre><code class="hljs lang-rust">fn main(){}</code></pre>');
    expect(detectCodeLanguage(code, pre)).toBe('rust');
  });

  test('falls back to a data-language attribute', () => {
    const { pre, code } = block('<pre><code data-language="sql">SELECT 1</code></pre>');
    expect(detectCodeLanguage(code, pre)).toBe('sql');
  });

  test('reads a header label when there is no class', () => {
    const { pre, code } = block(
      '<pre><div class="sticky top-0">powershell</div><code>Get-Item</code></pre>'
    );
    expect(detectCodeLanguage(code, pre)).toBe('powershell');
  });

  test('does not mistake a button caption for a language', () => {
    const { pre, code } = block(
      '<pre><div class="sticky top-0">Copy Edit</div><code>echo hi</code></pre>'
    );
    expect(detectCodeLanguage(code, pre)).toBe('');
  });

  test('takes the language from a header that also carries buttons', () => {
    const { pre, code } = block(
      '<pre><div class="sticky top-0">bash Copy Edit</div><code>echo hi</code></pre>'
    );
    expect(detectCodeLanguage(code, pre)).toBe('bash');
  });

  test('normalises case so PowerShell and powershell are one language', () => {
    const { pre, code } = block(
      '<pre><div class="sticky top-0">PowerShell</div><code>Get-Item</code></pre>'
    );
    expect(detectCodeLanguage(code, pre)).toBe('powershell');
  });

  test('returns empty rather than guessing when there is nothing to read', () => {
    const { pre, code } = block('<pre><code>plain</code></pre>');
    expect(detectCodeLanguage(code, pre)).toBe('');
  });

  test('rejects header prose that is not a single token', () => {
    const { pre, code } = block(
      '<pre><div class="sticky top-0">Always show details</div><code>x</code></pre>'
    );
    expect(detectCodeLanguage(code, pre)).toBe('');
  });
});

describe('extractTextContent fences (#263)', () => {
  test('emits the detected language on the opening fence', () => {
    document.body.innerHTML =
      '<div id="m">before<pre><code class="language-python">x = 1</code></pre>after</div>';
    const out = extractTextContent(document.getElementById('m'));
    expect(out).toContain('```python');
    expect(out).toContain('x = 1');
  });

  test('emits a bare fence when the language is unknown', () => {
    document.body.innerHTML =
      '<div id="m"><pre><code>plain text</code></pre></div>';
    const out = extractTextContent(document.getElementById('m'));
    expect(out).toContain('```\nplain text');
  });
});

// ============================================================================
// The shape ChatGPT actually renders (#263)
// ============================================================================

/**
 * ChatGPT's real code block, probed on the live page 2026-09-05 over 64 blocks:
 *
 *   pre.overflow-visible > … > div.cm-editor > div.cm-scroller > pre.cm-content > code
 *
 * Two consequences drive the fix, and neither is visible from the synthetic
 * fixture in tests/fixtures/chatgpt-conversation.html, which has a flat
 * <pre><code data-language="python"> that the live site does not produce:
 *
 *   - closest('pre') from the <code> stops at pre.cm-content, so a header in
 *     the outer block is outside the search scope no matter what selector is
 *     used. That, not the selector, is why the label was being missed.
 *   - the selector 'pre code, pre .cm-content' matches twice per block.
 */
function chatgptBlock(headerHtml, code) {
  document.body.innerHTML = `
    <div id="m"><p>before</p>
      <pre class="overflow-visible! px-0!">
        <div class="relative w-full my-4"><div class="contents">
          <div class="border border-token-border-light">
            ${headerHtml}
            <div class="relative z-0"><div class="q9tKkq_viewer cm-editor">
              <div class="cm-scroller">
                <pre class="cm-content q9tKkq_readonly"><code>${code}</code></pre>
              </div>
            </div></div>
            <button aria-label="Copy">Copy</button>
          </div>
        </div></div>
      </pre>
    <p>after</p></div>`;
  return document.getElementById('m');
}

describe("ChatGPT's real nesting (#263)", () => {
  test('the outermost <pre> is found from the <code>, not the CodeMirror one', () => {
    chatgptBlock('', 'x = 1');
    const code = document.querySelector('code');
    expect(code.closest('pre').className).toContain('cm-content');   // the trap
    expect(outermostPre(code).className).toContain('overflow-visible');
  });

  test('a header on the outer block is read even though closest() stops short', () => {
    chatgptBlock(
      '<div class="sticky z-2"><div class="flex text-sm">Python</div>' +
      '<button>Copy</button></div>', 'x = 1');
    const code = document.querySelector('code');
    expect(detectCodeLanguage(code, code.closest('pre'))).toBe('python');
  });

  test('the block is fenced exactly once, not once per selector match', () => {
    const el = chatgptBlock('', 'x = 1');
    // One real block, two selector matches: pre.cm-content, and the <code>
    // inside it. This is the count the fence must NOT follow.
    expect(el.querySelectorAll(SELECTORS.codeBlock)).toHaveLength(2);

    const out = extractTextContent(el);
    expect(out.match(/```/g)).toHaveLength(2);       // one opening, one closing
    expect(out).toContain('x = 1');
  });

  test("the block's own chrome does not leak into the text", () => {
    const el = chatgptBlock('', 'x = 1');
    const out = extractTextContent(el);
    // Replacing the inner CodeMirror pre would leave the outer block's Copy
    // button behind, next to the fence.
    expect(out).not.toContain('Copy');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });
});

// ============================================================================
// Sniffing, for the blocks that carry no label at all (#263)
// ============================================================================

/**
 * Probed on the live page over 64 blocks: <code> had no class and no data
 * attribute, and no header strip existed anywhere in the block. 540 of 606
 * blocks came back unlabelled because there was nothing to read, so the
 * content is the only evidence left.
 *
 * A wrong label is worse than none — it picks a wrong file extension and
 * nothing downstream can tell a guess from a read label — so the negative
 * cases below matter at least as much as the positive ones.
 */
describe('sniffCodeLanguage (#263)', () => {
  test('a shebang states the interpreter', () => {
    expect(sniffCodeLanguage('#!/usr/bin/env python3\nprint(1)\n')).toBe('python');
    expect(sniffCodeLanguage('#!/bin/bash\nls\n')).toBe('bash');
    expect(sniffCodeLanguage('#!/bin/sh\nls\n')).toBe('bash');
    expect(sniffCodeLanguage('#!/usr/bin/env node\nx\n')).toBe('javascript');
  });

  test('a body that parses as JSON is JSON', () => {
    expect(sniffCodeLanguage('{"a": 1, "b": [2, 3]}')).toBe('json');
    expect(sniffCodeLanguage('[\n  {"a": 1}\n]')).toBe('json');
  });

  test('something merely brace-shaped is not JSON', () => {
    expect(sniffCodeLanguage('{ not json at all }')).toBe('');
  });

  test('unified diff markers are unambiguous', () => {
    expect(sniffCodeLanguage('diff --git a/x b/x\n--- a/x\n+++ b/x\n')).toBe('diff');
    expect(sniffCodeLanguage('@@ -1,3 +1,4 @@\n context\n+added\n')).toBe('diff');
  });

  test('python structure', () => {
    expect(sniffCodeLanguage('def handle(request):\n    return 1\n')).toBe('python');
    expect(sniffCodeLanguage('from pathlib import Path\np = Path(".")\n')).toBe('python');
    expect(sniffCodeLanguage('class Foo:\n    pass\n')).toBe('python');
  });

  test('powershell cmdlets, but only when there are enough of them', () => {
    expect(sniffCodeLanguage(
      '$t = Get-ScheduledTask -TaskName x\nRegister-ScheduledTask -InputObject $t\n'))
      .toBe('powershell');
    expect(sniffCodeLanguage('param(\n  [string]$Path\n)\n')).toBe('powershell');
    // One cmdlet-shaped token in a shell line is not enough to claim the block.
    expect(sniffCodeLanguage('git config --global x y\n')).toBe('');
  });

  test('html and sql', () => {
    expect(sniffCodeLanguage('<!DOCTYPE html>\n<html></html>')).toBe('html');
    expect(sniffCodeLanguage('SELECT id FROM users WHERE x = 1;')).toBe('sql');
  });

  test('an ambiguous block stays unlabelled', () => {
    expect(sniffCodeLanguage('cd ~/Projects/Thing\nls -la\n')).toBe('');
    expect(sniffCodeLanguage('just some prose in a block')).toBe('');
    expect(sniffCodeLanguage('')).toBe('');
    expect(sniffCodeLanguage('   \n\n')).toBe('');
  });

  test('a declared label always beats a sniff', () => {
    // The code says python; the label says text. The label is a statement and
    // the sniff is an inference, so the statement wins.
    document.body.innerHTML =
      '<pre><div class="sticky">text</div><code class="language-text">import os</code></pre>';
    const pre = document.querySelector('pre');
    expect(detectCodeLanguage(pre.querySelector('code'), pre)).toBe('text');
  });

  test('detectCodeLanguage falls through to sniffing when nothing is declared', () => {
    document.body.innerHTML = '<pre><code>#!/bin/bash\nls\n</code></pre>';
    const pre = document.querySelector('pre');
    expect(detectCodeLanguage(pre.querySelector('code'), pre)).toBe('bash');
  });
});

describe('language aliases (#263)', () => {
  test.each([
    ['py', 'python'], ['PY', 'python'], ['js', 'javascript'], ['ts', 'typescript'],
    ['sh', 'bash'], ['zsh', 'bash'], ['ps1', 'powershell'], ['pwsh', 'powershell'],
    ['yml', 'yaml']
  ])('%s normalises to %s', (raw, expected) => {
    document.body.innerHTML =
      `<pre><div class="sticky">${raw}</div><code>x</code></pre>`;
    const pre = document.querySelector('pre');
    expect(detectCodeLanguage(pre.querySelector('code'), pre)).toBe(expected);
  });
});

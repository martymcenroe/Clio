/**
 * Code-block language detection (#263).
 *
 * Reading only the header strip labelled 73 of 636 blocks on a real
 * conversation. These pin the cases that were being missed, and the case that
 * was being got wrong.
 */

const { detectCodeLanguage, extractTextContent } = require('../extensions/src/content.js');
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

// Regression tests for extraction anomalies found in the first browser run.
// SELECTORS must exist before content.js is required (it reads the global).
global.SELECTORS = { codeBlock: 'pre code', site: 'claude' };
const { extractTextContent } = require('../extensions/src/content.js');

describe('#206 — CSS/<style> must not bleed into extracted text', () => {
  test('strips <style> (web-search widget keyframes) from the message subtree', () => {
    const el = document.createElement('div');
    el.innerHTML =
      'The load factor is ~0.90.<style>@keyframes slideUpFadeOut { 0% { transform: translateY(0); opacity: 1; } }</style> Research complete.';
    const out = extractTextContent(el);
    expect(out).toContain('The load factor is ~0.90.');
    expect(out).toContain('Research complete.');
    expect(out).not.toMatch(/@keyframes|translateY|opacity/);
  });

  test('strips <script> too', () => {
    const el = document.createElement('div');
    el.innerHTML = 'Answer text<script>window.x=1</script>';
    const out = extractTextContent(el);
    expect(out).toContain('Answer text');
    expect(out).not.toContain('window.x');
  });

  test('leaves real code blocks intact (only style/script removed)', () => {
    const el = document.createElement('div');
    el.innerHTML = 'Here:<pre><code>const a = 1;</code></pre>';
    expect(extractTextContent(el)).toContain('const a = 1;');
  });
});

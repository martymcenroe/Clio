/**
 * Block boundaries in extracted text (#426).
 *
 * textContent puts nothing between two elements, so paragraphs, list items and
 * headings stayed apart only where the page left whitespace between them.
 * Measured live on 2026-10-18: ChatGPT left none at 200 of 200 adjacent
 * blocks, Gemini at 3 of 3, Claude at 3 of 50, and a 162-message ChatGPT
 * export ran sentences together at 621 places in 62 of 77 replies.
 *
 * NOTE: innerHTML usage here is for test fixtures only (jsdom, not browser).
 */

const { extractTextContent, separateBlocks } = require('../extensions/src/content.js');
const { SELECTORS: CHATGPT } = require('../extensions/src/selectors-chatgpt.js');

beforeEach(() => {
  global.SELECTORS = CHATGPT;
});

/** A detached root holding exactly this markup, with no added whitespace. */
function root(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('separators between blocks', () => {
  test('T1: paragraphs, a list and a heading, with no whitespace between them', () => {
    const el = root('<p>a.</p><p>B.</p><ul><li>one</li><li>two</li></ul><h3>H</h3><p>c</p>');
    expect(extractTextContent(el)).toBe('a.\n\nB.\n\none\ntwo\n\nH\n\nc');
  });

  test('T2: a <br> is a line break', () => {
    expect(extractTextContent(root('<p>x<br>y</p>'))).toBe('x\ny');
  });

  test('T3: blocks the page already separates get no second separator', () => {
    const el = root('<p>a.</p>\n<p>B.</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<h3>H</h3>\n<p>c</p>');
    const text = extractTextContent(el);
    expect(text).not.toMatch(/\n[ \t]*\n[ \t]*\n/);
    expect(text).toBe('a.\nB.\n\none\ntwo\n\nH\nc');
  });

  test('T4: inline elements are untouched', () => {
    expect(extractTextContent(root('<p>a <strong>b</strong> <a href="#">c</a><em>d</em></p>'))).toBe('a b cd');
  });

  test('T4: a code fence\'s body, blank lines included, is unchanged', () => {
    const el = root('<p>Run:</p><pre><code class="language-python">def f():\n\n\n    return 1</code></pre><p>Done.</p>');
    // The fence's own newlines set it apart from the paragraphs beside it.
    expect(extractTextContent(el)).toBe('Run:\n```python\ndef f():\n\n\n    return 1\n```\nDone.');
  });

  test('text touching a block on either side is set apart from it', () => {
    expect(extractTextContent(root('before<p>inside</p>after'))).toBe('before\n\ninside\n\nafter');
  });

  test('empty blocks and comments separate nothing and are looked through', () => {
    const el = root('<p>a</p><!-- x --><hr><div></div><p>b</p>');
    expect(extractTextContent(el)).toBe('a\n\nb');
  });

  test('nested blocks: list items holding paragraphs', () => {
    expect(extractTextContent(root('<ol><li><p>one</p></li><li><p>two</p></li></ol>'))).toBe('one\ntwo');
  });

  test('table rows each on a line, cells apart within a row', () => {
    // The last boundaries left on a live ChatGPT export once blocks were
    // separated were table cells, 10 of 10.
    const el = root('<table><thead><tr><th>Col</th><th>Two</th></tr></thead><tbody>' +
      '<tr><td>a.</td><td>B</td></tr><tr><td><strong>c</strong></td><td>d</td></tr></tbody></table>');
    expect(extractTextContent(el)).toBe('Col | Two\na. | B\nc | d');
  });

  test('template whitespace between cells does not split a row', () => {
    const el = root('<table><tr>\n  <td>a</td>\n  <td>b</td>\n</tr><tr>\n  <td>c</td>\n  <td>d</td>\n</tr></table>');
    const lines = extractTextContent(el).split('\n').map(l => l.trim()).filter(Boolean);
    expect(lines).toEqual(['a | b', 'c | d']);
  });

  test('separateBlocks works on the root it is given and returns nothing', () => {
    const el = root('<p>a</p><p>b</p>');
    expect(separateBlocks(el)).toBeUndefined();
    expect(el.textContent).toBe('a\n\nb');
  });
});

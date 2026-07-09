// Enumeration reader tests (#54) — against REAL captured sidebar DOM, not
// hand-crafted fixtures (per the DOM-first rule).
const fs = require('fs');
const path = require('path');
const { collectConversations, cleanTitle } = require('../extensions/src/enumerate.js');

function loadDoc(name) {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('collectConversations — Claude (real captured DOM)', () => {
  let rows;
  beforeAll(() => { rows = collectConversations(loadDoc('sidebar-claude.html'), 'claude'); });

  test('finds all 32 conversations', () => {
    expect(rows.length).toBe(32);
  });
  test('every row has a claude /chat/ URL and an id', () => {
    expect(rows.every((r) => /^https:\/\/claude\.ai\/chat\/[0-9a-f-]+$/.test(r.url))).toBe(true);
    expect(rows.every((r) => r.conversation_id)).toBe(true);
  });
  test('ids are unique', () => {
    expect(new Set(rows.map((r) => r.conversation_id)).size).toBe(rows.length);
  });
  test('rows carry the site tag and a title', () => {
    expect(rows.every((r) => r.site === 'claude')).toBe(true);
    expect(rows.filter((r) => !r.title)).toEqual([]);
  });
});

describe('collectConversations — Gemini (real captured DOM)', () => {
  let rows;
  beforeAll(() => { rows = collectConversations(loadDoc('sidebar-gemini.html'), 'gemini'); });

  test('finds all 53 conversations with parseable ids', () => {
    expect(rows.length).toBe(53);
    expect(rows.every((r) => r.conversation_id && r.url.startsWith('https://gemini.google.com/app/'))).toBe(true);
  });
});

describe('cleanTitle', () => {
  test('collapses whitespace', () => {
    expect(cleanTitle('  a\n  b  ')).toBe('a b');
  });
  test('de-duplicates a doubled title (visible + tooltip)', () => {
    expect(cleanTitle('API usage informationAPI usage information')).toBe('API usage information');
  });
});

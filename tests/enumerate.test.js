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

  // Same reasoning as the Gemini row-0 assertion: the structural checks above
  // cannot tell a correct reader from one wiring ids and titles together wrongly.
  test('row 0 carries the fixture id and a non-empty scrubbed title', () => {
    expect(rows[0].site).toBe('claude');
    expect(rows[0].conversation_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(rows[0].url).toBe('https://claude.ai/chat/00000000-0000-4000-8000-000000000001');
    expect(rows[0].title).toEqual(expect.any(String));
    expect(rows[0].title.length).toBeGreaterThan(0);
  });
});

describe('collectConversations — Gemini (real captured DOM)', () => {
  let rows;
  beforeAll(() => { rows = collectConversations(loadDoc('sidebar-gemini.html'), 'gemini'); });

  test('finds all 53 conversations with parseable ids', () => {
    expect(rows.length).toBe(53);
    expect(rows.every((r) => r.conversation_id && r.url.startsWith('https://gemini.google.com/app/'))).toBe(true);
  });

  // Every other assertion in this file is structural -- counts, uniqueness, URL
  // shape -- and all of them pass just as happily if the title selector starts
  // matching the wrong node, or if id and title come from different rows. This
  // one pins row 0 to the exact values the scrubbed fixture holds, which is the
  // only thing here that would catch that (#358).
  //
  // Values are the scrubbed fixture's, from PR #340's tools/scrub-sidebar-fixtures.js.
  // They are synthetic by design: this repo is public, and the assertion this was
  // ported from carried the operator's real conversation title and id (#359).
  test('row 0 matches the fixture exactly', () => {
    expect(rows[0]).toEqual({
      site: 'gemini',
      conversation_id: 'c000000000000001',
      url: 'https://gemini.google.com/app/c000000000000001',
      title: 'Alder dogwood notes 1',
    });
  });
});

describe('cleanTitle', () => {
  test('collapses whitespace', () => {
    expect(cleanTitle('  a\n  b  ')).toBe('a b');
  });
  test('de-duplicates a doubled title (visible + tooltip)', () => {
    expect(cleanTitle('API usage informationAPI usage information')).toBe('API usage information');
  });
  test('de-duplicates a space-separated doubled title (#209)', () => {
    expect(cleanTitle('CLOSED: clustering of PES-LRP-SC5 CLOSED: clustering of PES-LRP-SC5'))
      .toBe('CLOSED: clustering of PES-LRP-SC5');
  });
  test('leaves a normal title untouched', () => {
    expect(cleanTitle('A perfectly normal title')).toBe('A perfectly normal title');
  });
});

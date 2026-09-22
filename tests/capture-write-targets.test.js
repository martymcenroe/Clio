// No e2e spec may write into a tracked directory (#363, #369, #370).
//
// This is a unit test, not an e2e test — it reads the spec sources, it does not
// run browsers, so it runs in `npm test` on every change.
//
// The rule it enforces was already written down. `artifact-dom-dump.spec.js`
// states it in its own header ("This spec does NOT write to tests/fixtures/ or
// any other tracked location"), and PR #340 scrubbed the fixtures precisely
// because raw captures had reached them. Two specs broke it anyway:
// `dom-discovery.spec.js`, committed, wrote page.content() over BOTH scrubbed
// sidebar fixtures on every run, and `sidebar-walk.spec.js` was staged to do
// the same to one of them. Stating the rule a third time is not the fix.
//
// Clio is PUBLIC and these captures are whole conversations. The failure is
// silent in both directions: nothing warns on the write, and every fixture
// assertion in the suite is structural (row counts, id uniqueness, URL shape),
// so a fixture full of real titles passes exactly as a scrubbed one does.
const fs = require('fs');
const path = require('path');
const { winningRule, isIgnoredByRepo, REPO } = require('./helpers/git-ignore');

const E2E_DIR = path.join(__dirname, 'e2e');
const SPECS = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.js'));

/** Strip comments so a path named only in prose is not mistaken for code. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every `path.join(__dirname, 'a', 'b', ...)` whose arguments are ALL string
 * literals, resolved to a repo-relative POSIX path.
 *
 * Calls with a non-literal argument (`path.join(CAPTURES_DIR, name)`) are
 * skipped deliberately: the constant they build on is itself a literal join and
 * is checked on its own. That keeps this a source scan rather than an
 * evaluator, at the cost of not chasing indirection — acceptable because the
 * directory is what has to be ignored, not the filename.
 */
function literalDirTargets(src) {
  const out = [];
  const callRe = /path\.join\(\s*__dirname\s*,([^)]*)\)/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const args = m[1];
    if (!args.trim()) continue;
    const parts = args.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.every((p) => /^'[^']*'$|^"[^"]*"$/.test(p))) continue;
    const segs = parts.map((p) => p.slice(1, -1));
    const abs = path.resolve(E2E_DIR, ...segs);
    out.push(path.relative(REPO, abs).split(path.sep).join('/'));
  }
  return out;
}

describe('e2e specs write only to ignored directories', () => {
  test('there are e2e specs to check', () => {
    expect(SPECS.length).toBeGreaterThan(0);
  });

  describe.each(SPECS)('%s', (spec) => {
    const src = stripComments(fs.readFileSync(path.join(E2E_DIR, spec), 'utf8'));
    const targets = literalDirTargets(src);

    // The repo root itself (path.join(__dirname,'..','..')) is used for
    // path.relative display and is not a write target.
    const dirs = targets.filter((t) => t !== '' && t !== '.');

    test('names at least one output directory', () => {
      expect(dirs.length).toBeGreaterThan(0);
    });

    test.each(dirs.length ? dirs : ['<none>'])('%s is ignored by the repo .gitignore', (dir) => {
      if (dir === '<none>') return;
      const rule = winningRule(`${dir}/probe.html`);
      // Named in the failure so a breakage says which rule was relied on --
      // "ignored by ~/.gitignore_global" is the specific bug in #370.
      expect({ dir, rule }).toEqual({ dir, rule: expect.objectContaining({ source: '.gitignore' }) });
      expect(isIgnoredByRepo(`${dir}/probe.html`)).toBe(true);
    });

    test('does not build a path into tests/fixtures', () => {
      expect(dirs.filter((d) => d.startsWith('tests/fixtures'))).toEqual([]);
    });
  });
});

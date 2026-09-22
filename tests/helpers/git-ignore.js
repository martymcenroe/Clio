// Ask git — not the .gitignore text — whether a path is ignored, and by which
// file (#367, #370).
//
// Not collected by jest: testMatch is '**/*.test.js'.
//
// Two things here are easy to get wrong and both have already bitten this repo:
//
//   - `git check-ignore -v` reports a winning NEGATION (`!data-dl/.../.gitkeep`)
//     as a match and exits 0. "A rule matched" is therefore not "is ignored".
//   - a path can be ignored by ~/.gitignore_global, which does not travel with
//     a clone. Asserting only that a path is ignored passes on this machine and
//     protects nothing anywhere else, which is exactly how docs/dom-dumps/ came
//     to be guarded by nothing at all.
//
// So callers get the winning rule's SOURCE, and are expected to assert on it.
const { execFileSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

/**
 * The winning gitignore rule for `p`, or null if no rule matched.
 * @returns {{source: string, line: number, pattern: string}|null}
 */
function winningRule(p) {
  let out;
  try {
    out = execFileSync('git', ['check-ignore', '-v', '--no-index', '--', p], {
      cwd: REPO,
      encoding: 'utf8',
    });
  } catch (e) {
    if (e.status === 1) return null; // git: not ignored, no output
    throw e;
  }
  // <source>:<line>:<pattern>\t<path>. The source may be an absolute Windows
  // path (C:/Users/...), so take the last two colon-separated fields rather
  // than splitting left to right.
  const rule = out.trim().split('\n')[0].split('\t')[0];
  const parts = rule.split(':');
  const pattern = parts.pop();
  const line = Number(parts.pop());
  return { source: parts.join(':'), line, pattern };
}

/** True iff `p` is actually ignored — a winning negation means it is not. */
function isIgnored(p) {
  const rule = winningRule(p);
  return rule !== null && !rule.pattern.startsWith('!');
}

/** True iff `p` is ignored by THIS REPO's .gitignore, not a machine-local file. */
function isIgnoredByRepo(p) {
  const rule = winningRule(p);
  return rule !== null && !rule.pattern.startsWith('!') && rule.source === '.gitignore';
}

module.exports = { winningRule, isIgnored, isIgnoredByRepo, REPO };

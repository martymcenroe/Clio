// The `data-dl/` ignore rules are a privacy boundary, not a convenience (#367).
//
// This repo is public and its whole job is downloading conversation exports, so
// "nothing in data-dl/ is committable except the scaffolding" has to be true,
// not merely intended. It was not: `data-dl/*` followed by `!data-dl/audio/`
// un-ignores the directory, git then descends into it, and nothing re-ignores
// its contents. Two of the three subdirectories offered everything for commit.
//
// The rules are checked here rather than read, and checked through git itself,
// because gitignore precedence is not something you can verify by looking at it.
//
// `git check-ignore` resolves hypothetical paths, so nothing is written to disk.
// `-v` is what makes this a real test: it names the file and line of the winning
// rule, which is how we assert the guarantee comes from the repo's own
// .gitignore and not from the machine's ~/.gitignore_global. A rule that only
// works on this machine does not survive a clone, and an assertion that a path
// is merely "ignored" would have passed on that accident.
const { execFileSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

/**
 * Winning gitignore rule for `p`, as { source, line, pattern }, or null if no
 * rule matched at all.
 *
 * Note this is "which rule won", NOT "is it ignored". `git check-ignore -v`
 * reports a winning NEGATION (`!data-dl/reference/.gitkeep`) as a match and
 * exits 0, so a non-null result here says nothing about ignored-ness on its
 * own. `isIgnored` below is the predicate; reading the rule is the point,
 * because we assert *which file* supplies the guarantee.
 */
function winningRule(p) {
  let out;
  try {
    out = execFileSync('git', ['check-ignore', '-v', '--no-index', '--', p], {
      cwd: REPO,
      encoding: 'utf8',
    });
  } catch (e) {
    // git exits 1 with no output when the path is not ignored.
    if (e.status === 1) return null;
    throw e;
  }
  // Format: <source>:<line>:<pattern>\t<path>. The source may be an absolute
  // Windows path (C:/Users/...), so split the rule side off the tab first and
  // take the last two colon-separated fields rather than the first.
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

const MUST_BE_IGNORED = [
  'data-dl/probe-toplevel.bin',
  'data-dl/audio/recording.m4a',
  // An extension no global ignore file is likely to carry: proves the repo rule
  // is doing the work, not a machine-local accident.
  'data-dl/audio/recording.clioprobe',
  'data-dl/transcripts/whisper-out.txt',
  'data-dl/transcripts/nested/deeper/out.json',
  'data-dl/reference/heavy.pdf',
  'data-dl/reference/spreadsheet.xlsx',
  'data-dl/reference/nested/deeper/paper.pdf',
];

const MUST_BE_COMMITTABLE = [
  'data-dl/README.md',
  'data-dl/audio/.gitkeep',
  'data-dl/transcripts/.gitkeep',
  'data-dl/reference/.gitkeep',
];

describe('data-dl/ is actually ignored', () => {
  test.each(MUST_BE_IGNORED)('%s is ignored', (p) => {
    expect(isIgnored(p)).toBe(true);
  });

  // The point of the exercise: the guarantee must be the repo's, not the
  // machine's. Before #367, data-dl/audio/*.m4a was ignored only because this
  // machine's global ignore file happens to carry *.m4a.
  test.each(MUST_BE_IGNORED)('%s is ignored by the repo .gitignore', (p) => {
    const rule = winningRule(p);
    expect(rule).not.toBeNull();
    expect(rule.source).toBe('.gitignore');
  });

  test.each(MUST_BE_COMMITTABLE)('%s is NOT ignored', (p) => {
    expect(isIgnored(p)).toBe(false);
  });

  // The scaffolding must survive on its own merits: each .gitkeep is committable
  // because an explicit negation in .gitignore says so, not because no rule
  // happened to match it. If a future edit drops `data-dl/audio/*`, the .gitkeep
  // stays committable either way and only this assertion notices the difference.
  test.each(MUST_BE_COMMITTABLE)('%s is committable via an explicit .gitignore negation', (p) => {
    const rule = winningRule(p);
    expect(rule).not.toBeNull();
    expect(rule.source).toBe('.gitignore');
    expect(rule.pattern.startsWith('!')).toBe(true);
  });
});

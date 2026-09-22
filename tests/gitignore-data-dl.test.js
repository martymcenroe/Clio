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
// The two traps — a winning negation counting as a match, and a path that is
// ignored only by ~/.gitignore_global — live in the shared helper.
const { winningRule, isIgnored } = require('./helpers/git-ignore');

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

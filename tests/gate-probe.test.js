// THROWAWAY PROBE (#383). This file exists to fail.
//
// It is here to prove that the `test` status check, made required on main in
// #376, actually blocks a merge rather than merely decorating the PR with a red
// mark. The PR carrying this file is never merged and this file never reaches
// main -- if you are reading it on main, something went wrong and it should be
// removed.
//
// The failure is deliberately loud, isolated to this file, and touches nothing
// else: no imports, no shared state, no fixtures. Every other suite must stay
// green so the PR's blocked state is attributable to this and nothing else.
describe('required-check gate probe (#383)', () => {
  test('fails on purpose, to prove the gate blocks', () => {
    expect('the gate blocks').toBe('deliberate failure - see #383');
  });
});

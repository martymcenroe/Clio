// Tests for the sweep comparison's structural-vs-race verdict (#337).
//
// The case that matters is the one the old `Math.max(3, ...)` floor got wrong:
// a single message missed in all three runs, at the miss rate actually measured
// across sweep-1 and sweep-2, is decisive evidence against the race hypothesis
// and used to be reported as "close to what a pure race predicts".

const { binomTailGE, assessAllMissed } = require('../tools/chatgpt/sweep-stats.js');

// Measured by `node tools/chatgpt/compare-sweeps.js sweep-1 sweep-2` on the
// real capture manifests, 2026-09-08.
const MEASURED = { unionTotal: 8405, pHat: 0.00577, R: 3 };

describe('binomTailGE', () => {
  test('k <= 0 is the whole distribution', () => {
    expect(binomTailGE(100, 0.1, 0)).toBe(1);
  });

  test('k above n is impossible', () => {
    expect(binomTailGE(10, 0.5, 11)).toBe(0);
  });

  test('matches a hand-checkable case: P(X >= 1) for n=2, p=0.5 is 0.75', () => {
    expect(binomTailGE(2, 0.5, 1)).toBeCloseTo(0.75, 12);
  });

  test('matches a hand-checkable case: P(X >= 2) for n=2, p=0.5 is 0.25', () => {
    expect(binomTailGE(2, 0.5, 2)).toBeCloseTo(0.25, 12);
  });

  test('is monotonically non-increasing in k', () => {
    let prev = 1;
    for (let k = 0; k <= 20; k++) {
      const p = binomTailGE(500, 0.02, k);
      expect(p).toBeLessThanOrEqual(prev + 1e-15);
      prev = p;
    }
  });

  test('stays accurate in the tiny-tail regime where 1 - lowerTail would cancel', () => {
    // n*p = 1.6e-3, so P(X >= 1) ~= n*p. Computing this as 1 - (1-p)^n in double
    // precision loses most of the significant digits; the direct upper-tail sum
    // does not.
    const n = 8405;
    const p = Math.pow(0.00577, 3);
    // P(X >= 1) = 1 - (1-p)^n agrees with n*p only to first order; they differ by
    // about (n*p)^2/2 ~= 1.3e-6, so this asserts agreement at that scale, not
    // exact equality.
    expect(binomTailGE(n, p, 1)).toBeCloseTo(n * p, 5);
    expect(binomTailGE(n, p, 1)).toBeGreaterThan(0);
    expect(binomTailGE(n, p, 1)).toBeLessThan(n * p); // strictly below, by inclusion-exclusion
  });

  test('P(X >= 2) is far smaller still, and strictly positive', () => {
    const n = 8405;
    const p = Math.pow(0.00577, 3);
    const tail = binomTailGE(n, p, 2);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThan(1e-5);
  });
});

describe('assessAllMissed — the case the old threshold got wrong', () => {
  test('one always-missed message at the measured rates is structural', () => {
    const v = assessAllMissed({ ...MEASURED, observed: 1 });
    expect(v.expected).toBeCloseTo(0.00161, 5);
    expect(v.pValue).toBeLessThan(0.01);
    expect(v.structural).toBe(true);
  });

  test('the old floor of 3 would have called that same case a race', () => {
    // The retired branch: excess > Math.max(3, 0.5 * observed).
    const observed = 1;
    const excess = observed - MEASURED.unionTotal * Math.pow(MEASURED.pHat, MEASURED.R);
    expect(excess > Math.max(3, 0.5 * observed)).toBe(false);
    // ...while the replacement calls it what it is.
    expect(assessAllMissed({ ...MEASURED, observed }).structural).toBe(true);
  });

  test('two and three always-missed are structural a fortiori', () => {
    for (const observed of [2, 3]) {
      expect(assessAllMissed({ ...MEASURED, observed }).structural).toBe(true);
    }
  });

  test('an empty all-missed bucket is never structural', () => {
    const v = assessAllMissed({ ...MEASURED, observed: 0 });
    expect(v.structural).toBe(false);
    expect(v.pValue).toBe(1);
  });

  test('a count consistent with a large null expectation is NOT structural', () => {
    // A corpus where the race alone predicts ~20 always-missed messages: an
    // observation of 20 is unremarkable and must not be called structural, even
    // though it is far more than the 4 the old floor demanded.
    const pHat = 0.3;              // p^3 = 0.027
    const unionTotal = Math.round(20 / Math.pow(pHat, 3));
    const v = assessAllMissed({ unionTotal, pHat, R: 3, observed: 20 });
    expect(v.expected).toBeCloseTo(20, 0);
    expect(v.structural).toBe(false);
    // The old rule would have fired on this: excess ~= 0 fails, but at observed
    // = 40 (still only 2x expectation) the old rule fires and the tail test
    // agrees -- the point is that the decision now scales with the null.
    expect(assessAllMissed({ unionTotal, pHat, R: 3, observed: 40 }).structural).toBe(true);
  });

  test('the verdict scales with the corpus, which a fixed count cannot', () => {
    // Same observed count, same per-run miss rate, corpus 1000x larger: the null
    // expectation rises with N, so the same observation stops being surprising.
    const small = assessAllMissed({ unionTotal: 8405, pHat: 0.01, R: 3, observed: 3 });
    const large = assessAllMissed({ unionTotal: 8405000, pHat: 0.01, R: 3, observed: 3 });
    expect(small.structural).toBe(true);
    expect(large.structural).toBe(false);
  });
});

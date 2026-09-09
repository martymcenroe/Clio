// Tests for the sweep comparison's statistics (#337, #346, #348).
//
// The central case is #348: the all-missed bucket is unreachable because the
// union is built from the runs' own id lists. A message no run captured is not
// counted as "missed by all" -- it is absent, and no union-based method can see
// it. Everything the old verdict rested on followed from not noticing that.

const {
  binomTailGE, binomTailLE, poissonBinomialPmf, assessBuckets, missCountsForConversation,
} = require('../tools/chatgpt/sweep-stats.js');

// Measured across the four completed block-one sweeps, 2026-09-09.
const BLOCK_ONE = {
  unionTotal: 8269,
  perRunMissed: [52, 101, 95, 120],
  missBuckets: [8068, 79, 77, 45, 0],
};

describe('missCountsForConversation — the #348 tautology', () => {
  test('a message no run captured is absent, not counted as missed-by-all', () => {
    // The truth is 4 messages. Every run captures a, b, c and none captures d.
    const runs = [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']];
    const m = missCountsForConversation(runs);
    expect(m.unionSize).toBe(3);            // d is simply not there
    expect(m.union.has('d')).toBe(false);
    expect(m.buckets[3]).toBe(0);           // the all-missed bucket, and it is 0
    expect(m.buckets[0]).toBe(3);
  });

  test('buckets[R] is zero across many shapes, because it cannot be otherwise', () => {
    const shapes = [
      [['a'], ['a'], ['a']],
      [['a', 'b'], ['a'], ['b']],
      [[], [], ['x']],
      [['a', 'b', 'c'], ['b'], ['c']],
      [['a'], [], []],
    ];
    for (const runs of shapes) {
      const m = missCountsForConversation(runs);
      expect(m.buckets[runs.length]).toBe(0);
    }
  });

  test('a message seen by exactly one run lands in bucket R-1, not R', () => {
    const m = missCountsForConversation([['a'], [], []]);
    expect(m.buckets[2]).toBe(1);
    expect(m.buckets[3]).toBe(0);
  });

  test('per-run misses and buckets agree with each other', () => {
    const m = missCountsForConversation([['a', 'b'], ['a'], ['a', 'b', 'c']]);
    // union {a,b,c}: a missed by none, b missed by run 1, c missed by runs 0 and 1
    expect(m.unionSize).toBe(3);
    expect(m.buckets).toEqual([1, 1, 1, 0]);
    expect(m.perRun).toEqual([1, 2, 0]);
    expect(m.perRun.reduce((a, b) => a + b, 0))
      .toBe(m.buckets.reduce((acc, n, k) => acc + n * k, 0));
  });
});

describe('poissonBinomialPmf', () => {
  test('is a probability distribution', () => {
    const pmf = poissonBinomialPmf([0.1, 0.2, 0.3]);
    expect(pmf).toHaveLength(4);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  test('reduces to the binomial when all rates are equal', () => {
    const p = 0.25;
    const pmf = poissonBinomialPmf([p, p, p]);
    expect(pmf[0]).toBeCloseTo((1 - p) ** 3, 12);
    expect(pmf[1]).toBeCloseTo(3 * p * (1 - p) ** 2, 12);
    expect(pmf[3]).toBeCloseTo(p ** 3, 12);
  });

  test('handles unequal rates, which is the reason it exists', () => {
    // Pooling 0.01 and 0.10 into 0.055 gets the both-missed term badly wrong.
    const exact = poissonBinomialPmf([0.01, 0.10])[2];
    expect(exact).toBeCloseTo(0.001, 12);
    const pooled = 0.055 ** 2;
    expect(pooled / exact).toBeGreaterThan(3);
  });
});

describe('binomTailGE / binomTailLE', () => {
  test('k <= 0 is the whole distribution', () => {
    expect(binomTailGE(100, 0.1, 0)).toBe(1);
  });

  test('k above n is impossible', () => {
    expect(binomTailGE(10, 0.5, 11)).toBe(0);
  });

  test('hand-checkable: n=2 p=0.5', () => {
    expect(binomTailGE(2, 0.5, 1)).toBeCloseTo(0.75, 12);
    expect(binomTailGE(2, 0.5, 2)).toBeCloseTo(0.25, 12);
    expect(binomTailLE(2, 0.5, 0)).toBeCloseTo(0.25, 12);
    expect(binomTailLE(2, 0.5, 1)).toBeCloseTo(0.75, 12);
  });

  test('the two tails are complementary', () => {
    for (const k of [0, 1, 2, 5, 9]) {
      expect(binomTailLE(20, 0.3, k) + binomTailGE(20, 0.3, k + 1)).toBeCloseTo(1, 10);
    }
  });

  test('upper tail is monotonically non-increasing in k', () => {
    let prev = 1;
    for (let k = 0; k <= 20; k++) {
      const p = binomTailGE(500, 0.02, k);
      expect(p).toBeLessThanOrEqual(prev + 1e-15);
      prev = p;
    }
  });

  test('stays accurate in the tiny-tail regime where 1 - lowerTail would cancel', () => {
    const n = 8269;
    const p = 1e-8;
    // P(X >= 1) ~= n*p to FIRST order; they differ by about (n*p)^2/2 ~= 3.4e-9,
    // so this asserts agreement at that scale. The complement form loses the
    // whole value, not just the second-order term.
    expect(binomTailGE(n, p, 1)).toBeCloseTo(n * p, 8);
    expect(binomTailGE(n, p, 1)).toBeGreaterThan(0);
    expect(binomTailGE(n, p, 1)).toBeLessThan(n * p);
  });
});

describe('assessBuckets', () => {
  test('only the observable buckets are assessed', () => {
    const a = assessBuckets(BLOCK_ONE);
    expect(a.buckets.map((b) => b.k)).toEqual([1, 2, 3]);
    expect(a.unreachableBucket).toBe(4);
  });

  test('block one is not an independent race, and says which way', () => {
    const a = assessBuckets(BLOCK_ONE);
    expect(a.independent).toBe(false);
    // Excess at 2 and 3 of 4, deficit at 1 of 4 -- correlated loss.
    expect(a.excesses.map((b) => b.k)).toEqual([2, 3]);
    expect(a.deficits.map((b) => b.k)).toEqual([1]);
    const three = a.buckets.find((b) => b.k === 3);
    expect(three.ratio).toBeGreaterThan(100);
    expect(three.pValue).toBeLessThan(1e-20);
  });

  test('the retired rule would have called block one a pure race', () => {
    // The old verdict looked only at missBuckets[R], which is structurally 0, so
    // it always took the "entirely a race" branch regardless of the data.
    expect(BLOCK_ONE.missBuckets[4]).toBe(0);
    expect(assessBuckets(BLOCK_ONE).independent).toBe(false);
  });

  test('data generated as an independent race is reported as one', () => {
    const rates = [0.01, 0.01, 0.01];
    const N = 100000;
    const pmf = poissonBinomialPmf(rates);
    const inUnion = 1 - pmf[3];
    const missBuckets = [0, 1, 2, 3].map((k) => Math.round(N * pmf[k] / inUnion));
    const perRunMissed = rates.map((r) => Math.round(r * N));
    const a = assessBuckets({ unionTotal: N, perRunMissed, missBuckets });
    expect(a.independent).toBe(true);
    expect(a.excesses).toHaveLength(0);
    expect(a.deficits).toHaveLength(0);
  });

  test('the union-conditioning correction is negligible at these rates, and is reported', () => {
    const a = assessBuckets(BLOCK_ONE);
    expect(a.allMissedProbability).toBeLessThan(1e-6);
    expect(a.allMissedProbability).toBeGreaterThan(0);
  });

  test('per-run rates are used, not a pooled one', () => {
    const a = assessBuckets(BLOCK_ONE);
    expect(a.rates).toHaveLength(4);
    expect(a.rates[0]).toBeCloseTo(52 / 8269, 12);
    expect(a.rates[3]).toBeCloseTo(120 / 8269, 12);
  });
});

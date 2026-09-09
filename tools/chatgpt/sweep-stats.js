// Statistics for the sweep comparison (#337, #346, #348). Separated from
// compare-sweeps.js so it can be unit-tested: that script runs its whole
// analysis at require time, so nothing inside it was reachable from a test.
//
// WHAT THIS CAN AND CANNOT ANSWER -- read this before adding a test here.
//
// compare-sweeps builds each conversation's message universe as the UNION of
// what the runs themselves captured. Every id in that union was contributed by
// at least one run, so no id can be missing from all R runs. The all-missed
// bucket is not merely usually empty; it is unreachable (#348).
//
// That kills the race-vs-systematic split the three-run design was built on.
// The systematic class -- messages the extractor never captures at all -- is
// invisible here by construction, and needs an instrument that does not consult
// a union: audit-drops.js (messagesLoaded - messageCount, #332) or the
// provider's own export (#307).
//
// So what IS testable here is the SHAPE of the loss among messages at least one
// run saw. Under an independent race, whether run i misses a given message is
// independent of whether run j does, and the number of runs missing it follows
// a Poisson binomial over the per-run rates. Correlated loss -- a message that
// is fragile for every run -- shows up as too few messages missed once and too
// many missed twice or more.
//
// WHY FITTING THE RATES FROM THIS DATA IS STILL LEGITIMATE. The per-run rates
// are estimated from these same runs, which pins each run's MARGINAL total. It
// does not pin how the misses CO-OCCUR across runs, and co-occurrence is exactly
// what the bucket distribution measures. The marginals are fitted; the
// dependence structure is tested. (An earlier version of this file tested only
// the all-missed bucket, on the reasoning that fitting a pooled p made the other
// buckets uninformative. Half right, and the wrong half: fitting the mean
// constrains the low buckets, not the shape -- and the bucket it did test could
// never be non-zero.)

/**
 * P(X >= k) for X ~ Binomial(n, p).
 *
 * Summed on the upper tail directly rather than as 1 - P(X <= k-1). The
 * complement form cancels catastrophically where this is used: the null means
 * here run down to ~1e-2 of a message, so the lower tail is 1 - 1e-2 and
 * subtracting it from 1 throws away the significant digits of the answer.
 */
function binomTailGE(n, p, k) {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return k <= n ? 1 : 0;
  if (k > n) return 0;

  const logQ = Math.log1p(-p);
  const logOdds = Math.log(p) - logQ;

  // log PMF at j = k, reached by the recurrence from j = 0. The bound is `<= k`:
  // each step advances one index, so stopping at `< k` lands on PMF(k-1) and
  // every tail comes out one term too large.
  let logPmf = n * logQ;
  for (let j = 1; j <= k; j++) logPmf += Math.log((n - j + 1) / j) + logOdds;

  let sum = 0;
  for (let j = k; j <= n; j++) {
    const term = Math.exp(logPmf);
    sum += term;
    // Past the mode the terms decay geometrically; stop once they cannot move
    // the total. Guarded on j > n*p so the break cannot fire on the way up.
    if (j > n * p && term < 1e-18 * (sum || 1)) break;
    if (j === n) break;
    logPmf += Math.log((n - j) / (j + 1)) + logOdds;
  }
  return Math.min(1, sum);
}

/** P(X <= k) for X ~ Binomial(n, p). The deficit direction. */
function binomTailLE(n, p, k) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const logQ = Math.log1p(-p);
  const logOdds = Math.log(p) - logQ;
  let logPmf = n * logQ;
  let sum = Math.exp(logPmf);
  for (let j = 1; j <= k; j++) {
    logPmf += Math.log((n - j + 1) / j) + logOdds;
    sum += Math.exp(logPmf);
  }
  return Math.min(1, sum);
}

/**
 * Union one conversation's per-run id lists and count, per message, how many
 * runs missed it.
 *
 * Extracted so the central property of this whole method is testable rather
 * than merely asserted in a comment: because the union is built FROM these
 * lists, every id in it came from some run, so `buckets[R]` cannot be non-zero.
 * A message no run captured is not counted as missed by all -- it is absent
 * entirely, and nothing here can see it (#348).
 *
 * @param {Array<string[]>} runIdLists one id list per run
 */
function missCountsForConversation(runIdLists) {
  const sets = runIdLists.map((ids) => new Set(ids));
  const R = sets.length;
  const union = new Set();
  for (const s of sets) for (const id of s) union.add(id);

  const buckets = new Array(R + 1).fill(0);
  const perRun = new Array(R).fill(0);
  const missedBy = new Map();
  for (const id of union) {
    const who = [];
    sets.forEach((s, i) => { if (!s.has(id)) { who.push(i); perRun[i] += 1; } });
    buckets[who.length] += 1;
    missedBy.set(id, who);
  }
  return { union, unionSize: union.size, buckets, perRun, missedBy };
}

/**
 * Distribution of "how many of these runs miss a given message" under
 * independence, given each run's own miss rate. Exact, by convolution.
 *
 * Per-run rates rather than one pooled rate: the runs here differ materially
 * (0.6% to 1.5% across four sweeps), and pooling them is the wrong family before
 * any question of dependence arises.
 *
 * @param {number[]} ps per-run miss probabilities
 * @returns {number[]} probabilities for k = 0..ps.length
 */
function poissonBinomialPmf(ps) {
  let dp = [1];
  for (const p of ps) {
    const next = new Array(dp.length + 1).fill(0);
    for (let k = 0; k < dp.length; k++) {
      next[k] += dp[k] * (1 - p);
      next[k + 1] += dp[k] * p;
    }
    dp = next;
  }
  return dp;
}

/**
 * Test the observable miss-count buckets against an independent race.
 *
 * Only k = 1 .. R-1 are observable. k = R is unreachable (see the header), and
 * k = 0 carries no information once the marginals are fitted.
 *
 * The null is conditioned on the message being in the union at all, since that
 * is what the observed counts are conditioned on. The correction is tiny while
 * the all-missed probability is small; `allMissedProbability` is returned so a
 * caller can see if it ever stops being small.
 *
 * @param {object} o
 * @param {number[]} o.perRunMissed  misses by run, over the union
 * @param {number}   o.unionTotal
 * @param {number[]} o.missBuckets   observed counts, index = number of runs missing
 * @param {number}   [o.alpha]
 */
function assessBuckets({ perRunMissed, unionTotal, missBuckets, alpha = 0.01 }) {
  const R = perRunMissed.length;
  const rates = perRunMissed.map((m) => (unionTotal > 0 ? m / unionTotal : 0));
  const pmf = poissonBinomialPmf(rates);
  const allMissed = pmf[R];
  const inUnion = 1 - allMissed;

  const buckets = [];
  for (let k = 1; k <= R - 1; k++) {
    const prob = inUnion > 0 ? pmf[k] / inUnion : 0;
    const expected = unionTotal * prob;
    const observed = missBuckets[k] || 0;
    const excess = observed > expected;
    const pValue = excess
      ? binomTailGE(unionTotal, prob, observed)
      : binomTailLE(unionTotal, prob, observed);
    buckets.push({
      k,
      observed,
      expected,
      prob,
      ratio: expected > 0 ? observed / expected : (observed > 0 ? Infinity : 1),
      direction: excess ? 'excess' : 'deficit',
      pValue,
      significant: pValue < alpha,
    });
  }

  const excesses = buckets.filter((b) => b.direction === 'excess' && b.significant);
  const deficits = buckets.filter((b) => b.direction === 'deficit' && b.significant);

  return {
    R,
    rates,
    alpha,
    unreachableBucket: R,
    allMissedProbability: allMissed,
    buckets,
    excesses,
    deficits,
    // Correlated loss is the actionable reading: a message missed by one run is
    // likelier than chance to be missed by another. A significant deficit at low
    // k is the mirror image of the same thing, so either direction refutes
    // independence.
    independent: excesses.length === 0 && deficits.length === 0,
  };
}

module.exports = {
  binomTailGE, binomTailLE, poissonBinomialPmf, assessBuckets, missCountsForConversation,
};

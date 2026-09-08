// Statistics for the sweep comparison (#337). Separated from compare-sweeps.js
// so it can be unit-tested: that script runs its whole analysis at require time,
// so nothing inside it was reachable from a test.
//
// THE QUESTION THIS ANSWERS. Across R independent captures of the same account,
// a message missed in every single run is either (a) unlucky -- an independent
// per-message race losing it R times over -- or (b) structural, a message the
// extractor cannot see at all. Those have different fixes: retry-and-merge fixes
// the first and does nothing for the second.
//
// The null hypothesis is the race: each run independently misses a given message
// with the pooled rate p, so the number of messages missed in all R runs is
// Binomial(N, p^R) where N is the union size. The test is the upper tail of that
// distribution at the observed count.
//
// WHAT THIS REPLACED, AND WHY IT MATTERED. The verdict used to be
//
//     excess > Math.max(3, 0.5 * missBuckets[R])
//
// which required four always-missed messages before it would call anything
// structural, regardless of how many were expected. At the measured N = 8405 and
// p = 0.577%, the null expects 0.0016 such messages; one observation is ~620x
// expectation, p = 0.0016 against the race -- and the old branch printed "close
// to what a pure race predicts". A fixed count cannot be a significance test,
// because the same count means opposite things at different N and p.

/**
 * P(X >= k) for X ~ Binomial(n, p).
 *
 * Summed on the upper tail directly rather than as 1 - P(X <= k-1). The
 * complement form cancels catastrophically exactly where this is used: the null
 * mean here is ~1e-3, so the lower tail is 1 - 1e-3 and subtracting it from 1
 * throws away every significant digit of the answer.
 *
 * @param {number} n trials
 * @param {number} p per-trial probability
 * @param {number} k observed count
 * @returns {number} upper-tail probability
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

/**
 * Read the all-missed bucket against the race null.
 *
 * @param {object} o
 * @param {number} o.unionTotal  messages in the union across runs (N)
 * @param {number} o.pHat        pooled per-message per-run miss rate
 * @param {number} o.R           number of runs
 * @param {number} o.observed    messages missed in ALL R runs
 * @param {number} [o.alpha]     significance threshold
 *
 * On alpha. It is 0.01, chosen from the cost asymmetry rather than convention.
 * A false negative here ends the investigation and ships an extractor that
 * silently drops messages; a false positive costs one manual read of the
 * always-missed list, which is printed directly below the verdict for exactly
 * that purpose. The test should lean toward flagging. The p-value is reported
 * alongside the verdict in any case, so a reader who disagrees with this
 * threshold is not captive to it.
 */
function assessAllMissed({ unionTotal, pHat, R, observed, alpha = 0.01 }) {
  const pAll = Math.pow(pHat, R);
  const expected = unionTotal * pAll;
  const pValue = observed > 0 ? binomTailGE(unionTotal, pAll, observed) : 1;
  return {
    expected,
    pValue,
    alpha,
    observed,
    structural: observed > 0 && pValue < alpha,
    ratio: expected > 0 ? observed / expected : Infinity,
  };
}

module.exports = { binomTailGE, assessAllMissed };

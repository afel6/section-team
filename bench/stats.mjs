// Small exact statistics for the mode round's pre-registered bars (spec "Bars and rules").

// Student's t at 0.975 (two-sided 95%) for 1 to 8 degrees of freedom: a round has at most 9 groups.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306]

export function tCrit975(df) {
  if (!Number.isInteger(df) || df < 1 || df > T975.length) {
    throw new RangeError(`tCrit975 covers 1 to ${T975.length} degrees of freedom, got ${df}`)
  }
  return T975[df - 1]
}

// Sample standard deviation (divisor n - 1).
export function sampleSD(xs) {
  if (xs.length < 2) throw new RangeError(`sampleSD needs at least 2 values, got ${xs.length}`)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1))
}

// x rounded to d decimals, half-up (Math.round).
export const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

// Exact two-sided sign test with p = 0.5: min(1, 2 × P(X ≤ min(wins, losses))) for X ~ Binomial(wins + losses, 0.5).
export function signTestP(wins, losses) {
  for (const k of [wins, losses]) {
    if (!Number.isInteger(k) || k < 0) throw new RangeError(`signTestP takes whole counts of at least 0, got ${k}`)
  }
  const n = wins + losses
  let choose = 1
  let tail = 0
  for (let k = 0; k <= Math.min(wins, losses); k++) {
    tail += choose
    choose = (choose * (n - k)) / (k + 1)
  }
  return Math.min(1, (2 * tail) / 2 ** n)
}

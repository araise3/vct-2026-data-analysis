/**
 * Glicko-2, implemented exactly as specified in Mark Glickman's
 * "Example of the Glicko-2 system" (Boston University, 22 March 2022) --
 * including the February 2012 revision of Step 5, which replaced the
 * original Newton-Raphson volatility solver with the Illinois variant of
 * regula falsi after the former turned out to diverge on poor starting
 * values.
 *
 * This file is deliberately domain-free: it knows nothing about maps,
 * matches, teams or years. All the VALORANT-specific choices (what counts
 * as a game, how long a rating period is, when a run resets) live in
 * teamRatings.js, so this half can be checked line-by-line against the
 * paper -- and it is: verifyWorkedExample() at the bottom reproduces the
 * paper's own numeric example.
 *
 * Ratings are carried on the familiar 1500-centred Glicko scale at the API
 * boundary and converted internally to the Glicko-2 scale (mu, phi), which
 * is what every formula below is written in. The conversion constant
 * 173.7178 is the paper's.
 *
 * Each competitor is a plain { rating, rd, vol } object. Nothing is
 * mutated -- every function returns a new object -- because the callers
 * keep the whole per-period history around for plotting.
 */

export const SCALE = 173.7178
export const DEFAULT_RATING = 1500
export const DEFAULT_RD = 350

/**
 * The paper's own default, with the explicit caveat that it "depends on
 * the particular application". 0.06 is a sane starting volatility for a
 * competitor we know nothing about; teamRatings.js keeps it.
 */
export const DEFAULT_VOL = 0.06

/**
 * tau constrains how fast volatility itself may move. The paper calls
 * 0.3-1.2 reasonable and recommends going as low as 0.2 when the data
 * contains "extremely improbable collections of game outcomes", since a
 * large tau lets one freak result inflate volatility and, through it,
 * swing the rating hard. Single VALORANT maps are exactly that kind of
 * data -- see teamRatings.js's TAU, which is chosen by measured predictive
 * log loss rather than by taking this default on faith.
 */
export const DEFAULT_TAU = 0.5

// The paper: "The value eps = 0.000001 is a sufficiently small choice."
const EPSILON = 1e-6

// Not in the paper -- a belt-and-braces cap so a pathological input can
// never hang the render thread. The paper's own simulations put the
// Illinois iteration count at a median of 5 and a maximum of 19 in 10000
// runs, so this is unreachable in practice.
const MAX_ITERATIONS = 1000

export function defaultPlayer(rating = DEFAULT_RATING, rd = DEFAULT_RD, vol = DEFAULT_VOL) {
  return { rating, rd, vol }
}

// Step 2: r -> mu, RD -> phi. Volatility is already on the Glicko-2 scale.
function toG2(player) {
  return {
    mu: (player.rating - DEFAULT_RATING) / SCALE,
    phi: player.rd / SCALE,
    vol: player.vol,
  }
}

// Step 8: back to the 1500-centred scale.
function fromG2(mu, phi, vol) {
  return { rating: SCALE * mu + DEFAULT_RATING, rd: SCALE * phi, vol }
}

// g(phi) -- the weight an opponent's own uncertainty gives their result.
// A result against a competitor we barely know moves us less.
function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

// E(mu, mu_j, phi_j) -- expected score against one opponent.
function E(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

/**
 * Step 5: solve for the new volatility sigma'.
 *
 * f(x) is the paper's; the bracket [A, B] is chosen so that it contains
 * ln(sigma'^2), then narrowed by the Illinois algorithm. The
 * delta^2 <= phi^2 + v branch is the one that needs the leftward search in
 * multiples of tau -- the paper notes k is "almost always 1, and very
 * rarely 2 or more".
 */
function newVolatility(phi, v, delta, vol, tau) {
  const a = Math.log(vol * vol)
  const phi2 = phi * phi
  const delta2 = delta * delta

  const f = (x) => {
    const ex = Math.exp(x)
    const denom = phi2 + v + ex
    return (ex * (delta2 - phi2 - v - ex)) / (2 * denom * denom) - (x - a) / (tau * tau)
  }

  let A = a
  let B
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v)
  } else {
    let k = 1
    while (f(a - k * tau) < 0 && k <= MAX_ITERATIONS) {
      k += 1
    }
    B = a - k * tau
  }

  let fA = f(A)
  let fB = f(B)
  let iterations = 0
  while (Math.abs(B - A) > EPSILON && iterations < MAX_ITERATIONS) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    // The Illinois half-step: when the root stays on the same side, the
    // retained endpoint's function value is halved so that endpoint stops
    // sticking -- which is exactly what plain regula falsi does badly.
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA = fA / 2
    }
    B = C
    fB = fC
    iterations += 1
  }

  return Math.exp(A / 2)
}

/**
 * Steps 3-8 for one competitor over one rating period.
 *
 * `results` is [{ rating, rd, score }] -- one entry per game played in the
 * period, `score` being 1 / 0.5 / 0 as the paper defines it. Opponents are
 * passed at their rating as it stood at the *start* of the period: a
 * rating period is treated as though every game in it happened
 * simultaneously, which is the whole premise of the system.
 *
 * With no results this falls through to applyInactivity (Step 6 alone),
 * matching the paper's closing note.
 */
export function updatePlayer(player, results, tau = DEFAULT_TAU) {
  if (!results || results.length === 0) return applyInactivity(player)

  const { mu, phi, vol } = toG2(player)

  // Step 3, and the sum inside Step 4, accumulated in one pass.
  let vInv = 0
  let deltaSum = 0
  for (const r of results) {
    const opp = toG2(r)
    const gj = g(opp.phi)
    const ej = E(mu, opp.mu, opp.phi)
    vInv += gj * gj * ej * (1 - ej)
    deltaSum += gj * (r.score - ej)
  }
  // Reaching 0 would need every opponent at an infinitely distant rating;
  // unreachable in practice, but dividing by it unguarded would silently
  // yield Infinity rather than fail loudly.
  if (vInv <= 0) return applyInactivity(player)

  const v = 1 / vInv
  const delta = v * deltaSum

  // Step 5.
  const volNew = newVolatility(phi, v, delta, vol, tau)

  // Step 6: pre-period RD, inflated by the freshly computed volatility.
  const phiStar = Math.sqrt(phi * phi + volNew * volNew)

  // Step 7.
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muNew = mu + phiNew * phiNew * deltaSum

  return fromG2(muNew, phiNew, volNew)
}

/**
 * A rating period the competitor sat out: only Step 6 applies. Rating and
 * volatility are unchanged, RD grows -- the system forgetting, at the rate
 * the competitor's own past inconsistency justifies.
 *
 * RD is capped at DEFAULT_RD. The paper doesn't specify a cap, but without
 * one a long absence pushes RD past the value a competitor we have never
 * seen at all is given, which is incoherent: no amount of not playing can
 * make us *less* informed than knowing nothing. This is the standard
 * implementation convention.
 */
export function applyInactivity(player, periods = 1) {
  let phi = player.rd / SCALE
  for (let i = 0; i < periods; i += 1) {
    phi = Math.sqrt(phi * phi + player.vol * player.vol)
  }
  return { rating: player.rating, rd: Math.min(SCALE * phi, DEFAULT_RD), vol: player.vol }
}

/**
 * The paper's 95% interval: rating +/- 2 RD. Volatility deliberately does
 * not appear in it.
 */
export function ratingInterval(player) {
  return [player.rating - 2 * player.rd, player.rating + 2 * player.rd]
}

/**
 * Probability that `a` beats `b` in a single game.
 *
 * Note this is NOT the paper's E(), which folds in the opponent's phi only
 * -- correct inside the update, where the subject's own uncertainty is
 * handled separately by v, but wrong as a forecast, where both sides'
 * uncertainty should flatten the prediction toward 50%. The combined
 * sqrt(phi_a^2 + phi_b^2) form is Glickman's own, from the Glicko-1 paper,
 * applied here on the Glicko-2 scale.
 */
export function winProbability(a, b) {
  const A = toG2(a)
  const B = toG2(b)
  return 1 / (1 + Math.exp(-g(Math.sqrt(A.phi * A.phi + B.phi * B.phi)) * (A.mu - B.mu)))
}

/**
 * Reproduces the worked example on pages 4-6 of the paper: a 1500/200/0.06
 * player at tau=0.5 beating a 1400/30, then losing to a 1550/100 and a
 * 1700/300, must come out at r'=1464.06, RD'=151.52, sigma'=0.05999.
 *
 * Kept in the shipped module rather than a test file because the repo has
 * no test runner (see CLAUDE.md) -- this way the check travels with the
 * code and can be run from a node one-liner, or from a browser console, at
 * any time.
 */
export function verifyWorkedExample() {
  const out = updatePlayer({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ], 0.5)
  const expected = { rating: 1464.06, rd: 151.52, vol: 0.05999 }
  return {
    actual: out,
    expected,
    ok: Math.abs(out.rating - expected.rating) < 0.01
      && Math.abs(out.rd - expected.rd) < 0.01
      && Math.abs(out.vol - expected.vol) < 0.00001,
  }
}

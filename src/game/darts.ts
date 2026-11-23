/*
 * BULLSEYE's maths. The game plays through the game API's Instant engine with the Target model: you pick a target
 * multiplier m, the server draws a hit value c with P(c >= m) = 0.96 / m (4% house edge, capped at ×1000), and you win
 * m × stake when c >= m. So every target, every ring, returns 96% over time.
 *
 * The board shows that honestly. Ring m is a circle of radius R / √m, so its area (and so its size on screen) is
 * exactly proportional to its chance. A throw lands at radius R / √c: inside ring m exactly when c >= m.
 */

export const RTP = 0.96;
export const MAX_TARGET = 1000;

export interface Ring {
  target: number;
  label: string;
}

/** The painted rings, outermost first. */
export const RINGS: Ring[] = [
  { target: 1.2, label: '1.2×' },
  { target: 1.5, label: '1.5×' },
  { target: 2, label: '2×' },
  { target: 3, label: '3×' },
  { target: 5, label: '5×' },
  { target: 10, label: '10×' },
  { target: 25, label: '25×' },
  { target: 50, label: '50×' },
];

/** Chance of a throw reaching target m. */
export const chanceOf = (m: number) => Math.min(1, RTP / m);

/** Radius (as a fraction of the board) of the circle that wins target m. */
export const radiusFor = (m: number) => 1 / Math.sqrt(Math.max(1, m));

/** Where a throw with hit value c lands: its radius as a fraction of the board (1 = the rim). */
export const landRadius = (c: number) => 1 / Math.sqrt(Math.max(1, c));

/** The best painted ring a hit value reaches, or null (off the rings). */
export function ringHit(c: number): Ring | null {
  let best: Ring | null = null;
  for (const r of RINGS) if (c >= r.target) best = r;
  return best;
}

export function clampTarget(m: number): number {
  return Math.min(MAX_TARGET, Math.max(1.01, Math.round(m * 100) / 100));
}

/** The throw's timeline: the arm winds up for WIND_MS, then the dart is in the air for FLY_MS. */
export const WIND_MS = 260;
export const FLY_MS = 430;
/** A throw started from a held pull (Space or a swipe) still waits at least this long before it lets go. */
export const MIN_RELEASE_MS = 140;

/**
 * stats.ts: small numeric and comp-band helpers shared by the deterministic tools.
 *
 * Comp is always expressed as ordered bands (B1 lowest to B5 highest), never as
 * exact numbers, in line with the product rule "ranges, never single points".
 */

/** Ordered compensation bands used across the synthetic cohort and tools. */
export const BANDS = ["B1", "B2", "B3", "B4", "B5"] as const;

/** A compensation band label. */
export type Band = (typeof BANDS)[number];

/** Index of a band label in BANDS, or -1 when the label is unknown. */
export const bandIdx = (band: string): number => BANDS.indexOf(band as (typeof BANDS)[number]);

/**
 * Band label for a (possibly fractional or out-of-range) index.
 * Rounds to the nearest band and clamps to the valid range, so callers never
 * receive `undefined`.
 */
export function bandAt(index: number): string {
  const clamped = Math.min(BANDS.length - 1, Math.max(0, Math.round(index)));
  return BANDS[clamped] as string;
}

/**
 * Linear-interpolated percentile of an ascending-sorted array.
 *
 * @param sorted ascending numbers
 * @param p      percentile as a fraction, e.g. 0.25 for P25
 * @returns the percentile value, or NaN for an empty array
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * p;
  const lowIndex = Math.floor(position);
  const highIndex = Math.ceil(position);
  const low = sorted[lowIndex] ?? NaN;
  const high = sorted[highIndex] ?? low;
  return low + (high - low) * (position - lowIndex);
}

/**
 * 95% Wilson score interval for a proportion k/n, each end rounded to two decimals and
 * clamped to [0, 1]. Returns [0, 0] when n is 0 (no data is not "0% to 100%": callers must
 * check n and say so).
 *
 * @throws RangeError unless k and n are integers with 0 <= k <= n (a proportion outside that has no meaning).
 */
export function wilsonInterval(k: number, n: number): [number, number] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) {
    throw new RangeError(`wilsonInterval needs integers with 0 <= k <= n (got k=${k}, n=${n}).`);
  }
  if (n === 0) return [0, 0];
  const p = k / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, +(centre - half).toFixed(2)), Math.min(1, +(centre + half).toFixed(2))];
}

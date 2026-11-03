/**
 * stats.ts: small numeric and comp-band helpers shared by the deterministic tools.
 *
 * Comp is always expressed as ordered bands (B1 lowest to B5 highest), never as
 * exact numbers, in line with the product rule "ranges, never single points".
 */

/** Ordered compensation bands used across the synthetic cohort and tools. */
export const BANDS = ["B1", "B2", "B3", "B4", "B5"] as const;

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

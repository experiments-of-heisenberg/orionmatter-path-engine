/** histogram.ts: bin the months-to-goal points for the spread chart, and choose a readable range for its axis. */
import type { ReachedPoint } from "../lib/engine/distribution";

export interface Bin {
  /** First month of the bin (inclusive). */
  start: number;
  /** First month after the bin (exclusive). */
  end: number;
  /** Engineers in the bin who met the person's limits. */
  within: number;
  /** Engineers in the bin who reached the goal but not within the limits. */
  outside: number;
}

/** The part of the time axis a chart shows. */
export interface Domain {
  from: number;
  to: number;
}

/** Width of a bin, in months. Three gives a graph-like shape for a few dozen engineers. */
export const BIN_MONTHS = 3;
/** The narrowest range a chart shows, so a tight cluster does not fill the whole width. */
export const MIN_SPAN = 24;

/**
 * Choose the months a chart should show: from a little before the first engineer to a little after the last,
 * widened to include the person's limit, rounded out to whole bins, and never narrower than MIN_SPAN.
 * Always starts at 0 or later and a multiple of BIN_MONTHS.
 */
export function zoomDomain(points: readonly ReachedPoint[], limit?: number): Domain {
  const months = points.map((p) => p.months);
  if (limit !== undefined) months.push(limit);
  if (months.length === 0) return { from: 0, to: MIN_SPAN };
  const lo = Math.min(...months);
  const hi = Math.max(...months);
  let from = Math.max(0, Math.floor((lo - BIN_MONTHS * 2) / BIN_MONTHS) * BIN_MONTHS);
  let to = Math.ceil((hi + BIN_MONTHS * 2) / BIN_MONTHS) * BIN_MONTHS;
  if (to - from < MIN_SPAN) {
    const extra = MIN_SPAN - (to - from);
    from = Math.max(0, from - Math.floor(extra / 2 / BIN_MONTHS) * BIN_MONTHS);
    to = from + Math.max(MIN_SPAN, to - from + Math.ceil(extra / 2 / BIN_MONTHS) * BIN_MONTHS);
  }
  return { from, to };
}

/**
 * Count the points into fixed-width bins covering the domain.
 * A point beyond either end is counted in the nearest bin, so no engineer is dropped from the picture.
 */
export function binPoints(points: readonly ReachedPoint[], domain: Domain, binMonths = BIN_MONTHS): Bin[] {
  const count = Math.max(1, Math.ceil((domain.to - domain.from) / binMonths));
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    start: domain.from + i * binMonths,
    end: domain.from + (i + 1) * binMonths,
    within: 0,
    outside: 0,
  }));
  for (const point of points) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((point.months - domain.from) / binMonths)));
    const bin = bins[index];
    if (bin) bin[point.within ? "within" : "outside"] += 1;
  }
  return bins;
}

/** The tallest bin, for scaling (at least 1 so an empty chart does not divide by zero). */
export function tallest(bins: readonly Bin[]): number {
  return Math.max(1, ...bins.map((b) => b.within + b.outside));
}

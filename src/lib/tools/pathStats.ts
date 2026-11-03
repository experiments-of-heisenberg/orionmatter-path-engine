/**
 * pathStats.ts: aggregates twin outcomes for one archetype into ranges.
 *
 * This is where "ranges, never single numbers" is enforced: the success rate
 * is a confidence interval and time-to-goal is a P25-P75 band, always reported
 * with the sample size so callers can tell thin evidence from strong evidence.
 */
import type { Archetype } from "../schemas";
import { COHORT, THIN_N } from "./data";
import { bandAt, bandIdx, percentile } from "./stats";

/** Aggregated outcomes for one archetype. Timing fields are null when no twin reached the goal. */
export interface PathStatsResult {
  /** Number of twins on this archetype (the sample size). */
  n: number;
  /** True when n is below the thin-evidence threshold, so callers must say "limited evidence". */
  evidenceThin: boolean;
  /** 95% Wilson interval for the share of twins who reached the goal, within [0, 1]. */
  reachedRate: [number, number];
  /** Months to goal among twins who reached it (25th percentile), or null if none did. */
  monthsP25: number | null;
  /** Median months to goal, or null if none reached it. */
  monthsP50: number | null;
  /** 75th percentile months to goal, or null if none reached it. */
  monthsP75: number | null;
  /** P25 to P75 comp band range among twins who reached the goal, or ["-", "-"]. */
  compBandRange: [string, string];
  topRisks: string[];
  topGates: string[];
  /** Most common company types along the routes of twins who reached the goal (up to 3). */
  topCompanyTypes: string[];
  /** Mean number of company moves among twins who reached the goal, one decimal; null if none did. */
  avgTransitions: number | null;
  /** Share of twins who reached the goal and work remotely, 0 to 1; null if none reached it. */
  remoteShare: number | null;
  /** Share of ALL twins on this archetype by outcome, each 0 to 1. Zeros when n = 0. */
  outcomeShares: { reached: number; stalled: number; leftField: number };
}

/** Arithmetic mean of a non-empty list. */
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Round to a fixed number of decimal places. */
const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;

/** Rounded percentile of ascending-sorted values, or null when there is nothing to measure. */
function roundedPercentile(sorted: number[], p: number): number | null {
  return sorted.length === 0 ? null : Math.round(percentile(sorted, p));
}

/**
 * Summarizes what happened to twins who followed one archetype.
 *
 * Time-to-goal percentiles and the comp-band range are computed over twins
 * who reached the goal; risks count the stalled and left-field shares.
 *
 * @param twinIds ids from findTwins; unknown ids are ignored, duplicates count once.
 * @param archetype one of climb, jump, or pivot; only matching twins are aggregated.
 * @returns sample size `n`, the `evidenceThin` flag (n < 15), the reached-rate
 * Wilson interval clamped to [0, 1], months-to-goal percentiles, the comp-band
 * P25-P75 range, and the most common risks and skill gates.
 * Edge: with no matching twins returns n = 0, evidenceThin = true,
 * reachedRate [0, 0], null months, compBandRange ["-", "-"], and empty lists.
 * With matches but no reached outcomes, months percentiles are null (never NaN,
 * which would silently become null in JSON and fail number validation) and the
 * comp-band range is ["-", "-"].
 */
export function pathStats(twinIds: string[], archetype: Archetype): PathStatsResult {
  const ids = new Set(twinIds);
  const rows = COHORT.filter((r) => ids.has(r.id) && r.archetype === archetype);
  const n = rows.length;
  if (n === 0)
    return {
      n: 0,
      evidenceThin: true,
      reachedRate: [0, 0],
      monthsP25: null,
      monthsP50: null,
      monthsP75: null,
      compBandRange: ["-", "-"],
      topRisks: [],
      topGates: [],
      topCompanyTypes: [],
      avgTransitions: null,
      remoteShare: null,
      outcomeShares: { reached: 0, stalled: 0, leftField: 0 },
    };
  const reached = rows.filter((r) => r.outcome === "reached");
  const months = reached.map((r) => r.months).sort((a, b) => a - b);
  // Wilson interval for reached rate
  const p = reached.length / n,
    z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  const reachedRate: [number, number] = [
    Math.max(0, +(centre - half).toFixed(2)),
    Math.min(1, +(centre + half).toFixed(2)),
  ];
  const ends = reached.map((r) => bandIdx(r.compBandEnd)).sort((a, b) => a - b);
  const compBandRange: [string, string] = ends.length
    ? [bandAt(percentile(ends, 0.25)), bandAt(percentile(ends, 0.75))]
    : ["-", "-"];
  const count = (xs: string[]) =>
    Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}))
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0]);
  const risks = [
    ...(rows.filter((r) => r.outcome === "stalled").length / n > 0.1 ? ["promotion stall"] : []),
    ...(rows.filter((r) => r.outcome === "left-field").length / n > 0.1 ? ["left the field / role"] : []),
  ];
  return {
    n,
    evidenceThin: n < THIN_N,
    reachedRate,
    monthsP25: roundedPercentile(months, 0.25),
    monthsP50: roundedPercentile(months, 0.5),
    monthsP75: roundedPercentile(months, 0.75),
    compBandRange,
    topRisks: risks,
    topGates: count(reached.flatMap((r) => r.skillsProven)).slice(0, 3),
    topCompanyTypes: count(reached.flatMap((r) => r.companyTypeSteps)).slice(0, 3),
    avgTransitions: reached.length ? round(mean(reached.map((r) => r.companyTypeSteps.length)), 1) : null,
    remoteShare: reached.length ? round(reached.filter((r) => r.remote).length / reached.length, 2) : null,
    outcomeShares: {
      reached: round(reached.length / n, 2),
      stalled: round(rows.filter((r) => r.outcome === "stalled").length / n, 2),
      leftField: round(rows.filter((r) => r.outcome === "left-field").length / n, 2),
    },
  };
}

/**
 * pathStats.ts: aggregates twin outcomes for one archetype into ranges.
 *
 * This is where "ranges, never single numbers" is enforced: the success rate
 * is a confidence interval and time-to-goal is a P25-P75 band, always reported
 * with the sample size so callers can tell thin evidence from strong evidence.
 */
import type { z } from "zod";
import type { Archetype as ArchetypeSchema } from "../schemas";
type Archetype = z.infer<typeof ArchetypeSchema>;
import { COHORT, THIN_N } from "./data";
import { bandAt, bandIdx, percentile } from "./stats";

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
 * reachedRate [0, 0], NaN months, compBandRange ["-", "-"], and empty lists.
 * With matches but no reached outcomes, months percentiles are NaN and the
 * comp-band range is ["-", "-"].
 */
export function pathStats(twinIds: string[], archetype: Archetype) {
  const ids = new Set(twinIds);
  const rows = COHORT.filter((r) => ids.has(r.id) && r.archetype === archetype);
  const n = rows.length;
  if (n === 0)
    return {
      n: 0,
      evidenceThin: true,
      reachedRate: [0, 0] as [number, number],
      monthsP25: NaN,
      monthsP50: NaN,
      monthsP75: NaN,
      compBandRange: ["-", "-"] as [string, string],
      topRisks: [] as string[],
      topGates: [] as string[],
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
    monthsP25: Math.round(percentile(months, 0.25)),
    monthsP50: Math.round(percentile(months, 0.5)),
    monthsP75: Math.round(percentile(months, 0.75)),
    compBandRange,
    topRisks: risks,
    topGates: count(reached.flatMap((r) => r.skillsProven)).slice(0, 3),
  };
}

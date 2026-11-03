/**
 * distribution.ts: when did each comparable engineer reach the goal?
 *
 * The route charts need more than a P25-P75 range: they show the whole spread of months, and which
 * of those engineers still count once the person's limits are applied (so a time-limit slider can
 * turn the late bars grey). This is the same cohort, the same twin matching and the same "within the
 * limits" rule as `pathStats`, computed here as a list of points instead of percentiles. It is not
 * a ledger tool: it feeds drawings, and nothing a model writes may cite it.
 */
import type { Archetype } from "../schemas";
import { COHORT } from "../tools/data";
import { findTwins } from "../tools/findTwins";
import { bandIdx } from "../tools/stats";
import { ARCHETYPES, limitsOf, type EngineInput } from "./facts";

/** One comparable engineer who reached the goal. */
export interface ReachedPoint {
  /** Months it took. */
  months: number;
  /** True when they also met the person's limits (time limit and pay floor). */
  within: boolean;
}

/**
 * The months-to-goal of every comparable engineer who reached the goal, per route, ascending.
 * Engineers who stalled or left the field are not here; their share is in the route's outcome shares.
 */
export function reachedPoints(input: EngineInput): Record<Archetype, ReachedPoint[]> {
  const twins = new Set(findTwins(input.profile, input.goal, input.constraints).twinIds);
  const limits = limitsOf(input.constraints);
  const floor = limits.minCompBand === undefined ? -1 : bandIdx(limits.minCompBand);
  const out: Record<Archetype, ReachedPoint[]> = { climb: [], jump: [], pivot: [] };
  for (const record of COHORT) {
    if (!twins.has(record.id) || record.outcome !== "reached") continue;
    out[record.archetype].push({
      months: record.months,
      within:
        (limits.maxMonths === undefined || record.months <= limits.maxMonths) &&
        (floor < 0 || bandIdx(record.compBandEnd) >= floor),
    });
  }
  for (const archetype of ARCHETYPES) out[archetype].sort((a, b) => a.months - b.months);
  return out;
}

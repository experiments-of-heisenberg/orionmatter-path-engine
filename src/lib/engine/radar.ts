/**
 * radar.ts: the six radar axes for a route, computed from tool results.
 *
 * Rule from the product: radar values are computed by code, never written by the model.
 * Every axis is an ABSOLUTE 0 to 100 score (not relative to the other routes), so a route
 * keeps the same shape when constraints change and What-if diffs stay meaningful.
 * Higher is always more favourable.
 *
 * Honesty about provenance: three axes come straight from outcome data, three are
 * proxies the cohort lets us measure. `RADAR_BASIS` states exactly what each one is and
 * the UI shows it, so a viewer never mistakes a proxy for a direct measurement.
 */
import type { Radar } from "../schemas";
import type { PathStatsResult } from "../tools/pathStats";
import { BANDS, bandIdx } from "../tools/stats";

/** Plain-language definition of each axis, shown in the UI. */
export const RADAR_BASIS: Readonly<Record<keyof Radar, string>> = {
  comp: "Comp band reached: the middle of the P25-P75 comp band range among twins who reached the goal.",
  speed:
    "Speed: median months to goal among twins who reached it; 12 months or fewer scores 100, 60 or more scores 0.",
  risk: "Odds of success (a low-risk score): midpoint of the 95% interval for the share of twins who reached the goal.",
  learning:
    "Learning (proxy): average number of company moves among twins who reached the goal; 3 or more moves scores 100.",
  balance: "Work-life balance (proxy): share of twins who reached the goal while working remotely.",
  stability: "Stability: share of twins who did not leave the field on this route.",
};

const MONTHS_BEST = 12;
const MONTHS_WORST = 60;
const MAX_TRANSITIONS = 3;

/** Clamp to [0, 1]. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Convert a 0 to 1 fraction to a whole 0 to 100 score. */
const score = (fraction: number): number => Math.round(clamp01(fraction) * 100);

/** Mean band index (0 = B1) of a P25-P75 band range, as a 0 to 1 fraction. Unknown bands give 0. */
function bandFraction(range: [string, string]): number {
  const low = bandIdx(range[0]);
  const high = bandIdx(range[1]);
  if (low < 0 || high < 0) return 0;
  return (low + high) / 2 / (BANDS.length - 1);
}

/**
 * Compute the radar for one archetype.
 *
 * @param stats result of the pathStats tool for that archetype
 * @returns the six axes, each a whole number from 0 to 100; all zeros when there is no data
 */
export function computeRadar(stats: PathStatsResult): Radar {
  if (stats.n === 0) return { comp: 0, speed: 0, risk: 0, learning: 0, balance: 0, stability: 0 };
  const speedFraction =
    stats.monthsP50 === null ? 0 : (MONTHS_WORST - stats.monthsP50) / (MONTHS_WORST - MONTHS_BEST);
  return {
    comp: score(bandFraction(stats.compBandRange)),
    speed: score(speedFraction),
    risk: score((stats.reachedRate[0] + stats.reachedRate[1]) / 2),
    learning: score(stats.avgTransitions === null ? 0 : stats.avgTransitions / MAX_TRANSITIONS),
    balance: score(stats.remoteShare ?? 0),
    stability: score(1 - stats.outcomeShares.leftField),
  };
}

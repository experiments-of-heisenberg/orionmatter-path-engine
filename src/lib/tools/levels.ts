/**
 * levels.ts: seniority ranks for the canonical level ladder.
 *
 * Why this exists: levels are labels ("L5", "EM1"), not numbers, and the engineering
 * and management tracks interleave. Parsing digits out of the label (the first
 * version) ranked EM1 as 1, so a manager matched no engineers at all. An explicit
 * table makes the comparison deliberate and testable.
 *
 * The EM ranks are approximate seniority parity (illustrative, like the level map
 * itself): a first-line manager (EM1) is treated as comparable to L5 and a
 * second-line manager (EM2) to L6.
 */

/** Seniority rank per canonical level. Must cover every level in data/level-map.json. */
const LEVEL_RANK: Readonly<Record<string, number>> = {
  L3: 3,
  L4: 4,
  L5: 5,
  L6: 6,
  L7: 7,
  EM1: 5,
  EM2: 6,
};

/**
 * Seniority rank of a canonical level.
 *
 * @param level canonical level label, e.g. "L5" or "EM1".
 * @returns the rank, or undefined for a label that is not on the ladder.
 */
export function levelRank(level: string): number | undefined {
  return LEVEL_RANK[level];
}

/** All canonical levels that have a rank, used by tests to guard against drift from the level map. */
export const RANKED_LEVELS: readonly string[] = Object.keys(LEVEL_RANK);

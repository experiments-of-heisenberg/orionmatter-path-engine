/**
 * findTwins.ts: matches the user with comparable synthetic engineers ("twins").
 *
 * Twins are the evidence base for every plan: later tools only aggregate over
 * twin ids, so the planner never reasons about the user in isolation.
 */
import type { Constraints, Goal, Profile } from "../schemas";
import { COHORT } from "./data";
import { levelRank } from "./levels";

/**
 * Finds synthetic engineers comparable to the user.
 *
 * A cohort record is a twin when it shares the user's role family, ended at
 * the goal's target level, and started within one seniority rank of the user's
 * level (see levels.ts; e.g. L4 is one away from L5, and EM1 ranks like L5). When
 * `constraints.remote` is set only remote twins are kept; when
 * `constraints.noRelocation` is set only twins in the user's region (or remote
 * twins) are kept.
 *
 * @param profile user's current position (role family, level, region).
 * @param goal target level the twins must have reached.
 * @param constraints optional what-if knobs; only `remote` and `noRelocation` affect matching.
 * @returns twin ids with `n` always equal to `twinIds.length`; both empty when nothing matches
 * or when the profile's level is not on the canonical ladder.
 */
export function findTwins(profile: Profile, goal: Goal, constraints: Partial<Constraints> = {}) {
  const userRank = levelRank(profile.level);
  // An unrecognised level cannot be compared, so it matches nobody (rather than guessing).
  if (userRank === undefined) return { twinIds: [] as string[], n: 0 };

  const twins = COHORT.filter((r) => {
    const startRank = levelRank(r.startLevel);
    return (
      startRank !== undefined &&
      r.roleFamily === profile.roleFamily &&
      r.endLevel === goal.targetLevel &&
      Math.abs(startRank - userRank) <= 1 &&
      (constraints.remote ? r.remote : true) &&
      (constraints.noRelocation ? r.region === profile.region || r.remote : true)
    );
  });
  return { twinIds: twins.map((t) => t.id), n: twins.length };
}

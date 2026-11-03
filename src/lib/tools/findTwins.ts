/**
 * findTwins.ts: matches the user with comparable synthetic engineers ("twins").
 *
 * Twins are the evidence base for every plan: later tools only aggregate over
 * twin ids, so the planner never reasons about the user in isolation.
 */
import type { Constraints, Goal, Profile } from "../schemas";
import { COHORT } from "./data";

/**
 * Finds synthetic engineers comparable to the user.
 *
 * A cohort record is a twin when it shares the user's role family, ended at
 * the goal's target level, and started within one level of the user's level
 * (compared numerically, e.g. L4 is one away from L5). When
 * `constraints.remote` is set only remote twins are kept; when
 * `constraints.noRelocation` is set only twins in the user's region (or remote
 * twins) are kept.
 *
 * @param profile user's current position (role family, level, region).
 * @param goal target level the twins must have reached.
 * @param constraints optional what-if knobs; only `remote` and `noRelocation` affect matching.
 * @returns twin ids with `n` always equal to `twinIds.length`; both empty when nothing matches.
 */
export function findTwins(profile: Profile, goal: Goal, constraints: Partial<Constraints> = {}) {
  const lv = (s: string) => Number(s.replace(/\D/g, "")) || 0;
  const twins = COHORT.filter(
    (r) =>
      r.roleFamily === profile.roleFamily &&
      r.endLevel === goal.targetLevel &&
      Math.abs(lv(r.startLevel) - lv(profile.level)) <= 1 &&
      (constraints.remote ? r.remote : true) &&
      (constraints.noRelocation ? r.region === profile.region || r.remote : true),
  );
  return { twinIds: twins.map((t) => t.id), n: twins.length };
}

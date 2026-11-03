import type { Constraints, Goal, Profile } from "../schemas";
import { COHORT } from "./data";

/** Nearest synthetic engineers: same role family, start level within 1, goal level match; optional remote filter. */
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

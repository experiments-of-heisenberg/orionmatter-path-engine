import type { CohortRecord } from "../schemas";
import { COHORT } from "./data";

export type AnonAttrs = Partial<Pick<CohortRecord, "roleFamily" | "startLevel" | "endLevel" | "region">> & {
  companyType?: string;
};

/** Size of the group of cohort records sharing all given attributes. Drop attributes one by one to find which make the person unique. */
export function kAnonymity(attrs: AnonAttrs, cohort: CohortRecord[] = COHORT, k = 10) {
  const match = (a: AnonAttrs) =>
    cohort.filter(
      (r) =>
        (a.roleFamily === undefined || r.roleFamily === a.roleFamily) &&
        (a.startLevel === undefined || r.startLevel === a.startLevel) &&
        (a.endLevel === undefined || r.endLevel === a.endLevel) &&
        (a.region === undefined || r.region === a.region) &&
        (a.companyType === undefined || r.companyTypeSteps.includes(a.companyType)),
    ).length;
  const groupSize = match(attrs);
  // Greedy: repeatedly drop the attribute whose removal grows the group most, until k is reached.
  const offendingAttrs: string[] = [];
  if (groupSize < k) {
    const cur = { ...attrs };
    while (match(cur) < k && Object.keys(cur).length > 0) {
      let best: keyof AnonAttrs | null = null,
        bestSize = -1;
      for (const key of Object.keys(cur) as (keyof AnonAttrs)[]) {
        const rest = { ...cur };
        delete rest[key];
        const size = match(rest);
        if (size > bestSize) {
          bestSize = size;
          best = key;
        }
      }
      if (!best) break;
      offendingAttrs.push(best);
      delete cur[best];
    }
  }
  return { passes: groupSize >= k, groupSize, offendingAttrs };
}

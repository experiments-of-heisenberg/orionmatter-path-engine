/**
 * kAnonymity.ts: measures re-identification risk for a career profile.
 *
 * The Privacy Guard asks how many cohort records share a person's coarsened
 * attributes (role family, level, region, company type). A small group means the
 * attribute combination could single someone out, so the story must be generalised
 * before it is shared. This is the deterministic half of the Privacy Guard; the
 * free-text half runs on the open-weights model.
 */
import type { CohortRecord } from "../schemas";
import { COHORT } from "./data";

/**
 * Cohort attributes defining an anonymity group. All optional: an empty object
 * matches the whole cohort. `companyType` matches when it appears anywhere in
 * a record's company-type history.
 */
export type AnonAttrs = Partial<Pick<CohortRecord, "roleFamily" | "startLevel" | "endLevel" | "region">> & {
  companyType?: string;
};

/**
 * Checks whether an attribute combination covers at least k cohort records.
 *
 * @param attrs attributes defining the group; undefined fields are wildcards.
 * @param cohort records to search; defaults to the full synthetic cohort.
 * @param k minimum group size; defaults to 10.
 * @returns whether the group passes, its size, and — only when it fails — the
 * attributes to drop (greedily, most-covering first) until k would be reached.
 * Edge: an empty `attrs` matches the whole cohort; `offendingAttrs` is empty
 * whenever the check passes.
 */
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

/**
 * skillStats.ts: how twins who proved a skill fared compared with twins who did not.
 *
 * This answers "what if I learn Rust?" with evidence, and with the honesty it needs:
 *   - It is ASSOCIATION, never cause: people who prove a skill may differ in other ways.
 *   - Both groups carry a sample size and a 95% interval, and `distinguishable` is true only
 *     when those intervals do not overlap. Overlap means "we cannot tell", and the interface says so.
 *   - A skill the cohort never recorded returns `known: false`: there is simply no evidence.
 *
 * Same definition of "reached" as pathStats, including the person's limits.
 */
import type { Archetype } from "../schemas";
import { COHORT, THIN_N } from "./data";
import type { PathLimits } from "./pathStats";
import { bandIdx, percentile, wilsonInterval } from "./stats";

/** The skills the cohort records, as written in the data (lower-case, hyphenated). */
export const COHORT_SKILLS: readonly string[] = [...new Set(COHORT.flatMap((r) => r.skillsProven))].sort();

/** Everyday spellings people use, mapped to the cohort's names. */
const ALIASES: Readonly<Record<string, string>> = {
  k8s: "kubernetes",
  mlops: "ml-ops",
  "ml ops": "ml-ops",
  "system design": "system-design",
  "systems design": "system-design",
  "distributed systems": "distributed-systems",
  "cross team lead": "cross-team-lead",
  "cross-team leadership": "cross-team-lead",
  "cross team leadership": "cross-team-lead",
  "tech lead": "cross-team-lead",
};

/**
 * Map a skill as a person wrote it to the cohort's name for it, or undefined when the cohort
 * has no such skill. Matching is exact after lower-casing and treating spaces as hyphens:
 * there is no fuzzy matching, because a wrong match would attach real numbers to the wrong skill.
 */
export function matchCohortSkill(raw: string): string | undefined {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const candidate = ALIASES[text] ?? text.replace(/ /g, "-");
  return COHORT_SKILLS.includes(candidate) ? candidate : undefined;
}

/** Outcomes for one group of twins (with the skill, or without it). */
export interface SkillGroup {
  n: number;
  /** Twins who reached the goal within the limits. */
  reachedN: number;
  /** 95% interval for the reached share; [0, 0] when n is 0. */
  reachedRate: [number, number];
  /** Median months among those who reached it, or null. */
  monthsP50: number | null;
}

/** The result of the skillStats tool. */
export interface SkillStatsResult {
  /** The skill as asked (normalised), echoed back. */
  skill: string;
  /** The cohort's name for it, or null when the cohort never recorded this skill. */
  cohortSkill: string | null;
  /** True when the cohort has evidence about this skill at all. */
  known: boolean;
  withSkill: SkillGroup;
  withoutSkill: SkillGroup;
  /** True when either group is smaller than the thin-evidence threshold. */
  evidenceThin: boolean;
  /** True only when the two reached-rate intervals do not overlap (a difference we can see through the noise). */
  distinguishable: boolean;
}

const emptyGroup = (): SkillGroup => ({ n: 0, reachedN: 0, reachedRate: [0, 0], monthsP50: null });

/**
 * Compare twins on one archetype who proved a skill with those who did not.
 *
 * @param twinIds ids from findTwins
 * @param archetype climb, jump or pivot
 * @param skill the skill as the person wrote it
 * @param limits the person's limits, so "reached" means the same here as in pathStats
 */
export function skillStats(
  twinIds: string[],
  archetype: Archetype,
  skill: string,
  limits: PathLimits = {},
): SkillStatsResult {
  const asked = skill.trim().toLowerCase().replace(/\s+/g, " ");
  const cohortSkill = matchCohortSkill(asked) ?? null;
  if (cohortSkill === null) {
    return {
      skill: asked,
      cohortSkill: null,
      known: false,
      withSkill: emptyGroup(),
      withoutSkill: emptyGroup(),
      evidenceThin: true,
      distinguishable: false,
    };
  }
  const ids = new Set(twinIds);
  const rows = COHORT.filter((r) => ids.has(r.id) && r.archetype === archetype);
  const floor = limits.minCompBand === undefined ? -1 : bandIdx(limits.minCompBand);
  const reachedWithin = (r: (typeof rows)[number]): boolean =>
    r.outcome === "reached" &&
    (limits.maxMonths === undefined || r.months <= limits.maxMonths) &&
    (floor < 0 || bandIdx(r.compBandEnd) >= floor);

  const group = (members: typeof rows): SkillGroup => {
    const reached = members.filter(reachedWithin);
    const months = reached.map((r) => r.months).sort((a, b) => a - b);
    return {
      n: members.length,
      reachedN: reached.length,
      reachedRate: wilsonInterval(reached.length, members.length),
      monthsP50: months.length ? Math.round(percentile(months, 0.5)) : null,
    };
  };
  const withSkill = group(rows.filter((r) => r.skillsProven.includes(cohortSkill)));
  const withoutSkill = group(rows.filter((r) => !r.skillsProven.includes(cohortSkill)));
  const bothMeasured = withSkill.n > 0 && withoutSkill.n > 0;
  return {
    skill: asked,
    cohortSkill,
    known: true,
    withSkill,
    withoutSkill,
    evidenceThin: withSkill.n < THIN_N || withoutSkill.n < THIN_N,
    distinguishable:
      bothMeasured &&
      (withSkill.reachedRate[0] > withoutSkill.reachedRate[1] ||
        withoutSkill.reachedRate[0] > withSkill.reachedRate[1]),
  };
}

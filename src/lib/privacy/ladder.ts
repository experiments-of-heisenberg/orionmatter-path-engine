/**
 * ladder.ts: the disclosure ladder, from the deterministic k-anonymity tool.
 *
 * Start with one attribute and add the next, counting each time how many comparable engineers in the
 * cohort still match. The crowd can only shrink, so the ladder shows exactly where a person stops
 * being one of many. No model is involved.
 */
import type { Goal, Profile } from "../schemas";
import { COHORT } from "../tools/data";
import { kAnonymity, type AnonAttrs } from "../tools/kAnonymity";
import type { LadderRung } from "./schemas";

/** Default size of crowd a person should stay hidden in. */
export const DEFAULT_K = 10;

/** The cohort's starting levels: the only ones an exact match can use. */
const START_LEVELS: readonly string[] = [...new Set(COHORT.map((r) => r.startLevel))];

/** What the ladder is built from. */
export interface LadderInput {
  profile: Profile;
  goal: Goal;
  /** A company type the person would mention (for example "seriesB-fintech"), if any. */
  companyType?: string;
  k?: number;
}

export interface LadderResult {
  rungs: LadderRung[];
  fullPasses: boolean;
  shareableUpTo: string | null;
  dropToReachK: string[];
  /** Observations such as a level the data cannot count exactly. */
  notes: string[];
}

/**
 * Compute the ladder.
 *
 * @throws RangeError unless k is a whole number of at least 1
 */
export function disclosureLadder(input: LadderInput): LadderResult {
  const k = input.k ?? DEFAULT_K;
  if (!Number.isInteger(k) || k < 1)
    throw new RangeError(`k must be a whole number of at least 1 (got ${k}).`);
  const { profile, goal } = input;
  const notes: string[] = [];
  const steps: { added: string; label: string; apply: (a: AnonAttrs) => AnonAttrs }[] = [
    { added: "role", label: profile.roleFamily, apply: (a) => ({ ...a, roleFamily: profile.roleFamily }) },
  ];
  if (START_LEVELS.includes(profile.level)) {
    steps.push({
      added: "level",
      label: profile.level,
      apply: (a) => ({ ...a, startLevel: profile.level as "L4" | "L5" }),
    });
  } else {
    notes.push(
      `The data only has engineers who started at ${START_LEVELS.join(" or ")}, so your level (${profile.level}) cannot be counted exactly and is left out of the ladder. Your real crowd is smaller than shown.`,
    );
  }
  steps.push({
    added: "goal",
    label: `goal ${goal.targetLevel}`,
    apply: (a) => ({ ...a, endLevel: goal.targetLevel as "L6" | "EM1" }),
  });
  steps.push({ added: "region", label: profile.region, apply: (a) => ({ ...a, region: profile.region }) });
  if (input.companyType) {
    const type = input.companyType;
    steps.push({ added: "company type", label: type, apply: (a) => ({ ...a, companyType: type }) });
  }

  let attrs: AnonAttrs = {};
  const labels: string[] = [];
  const rungs: LadderRung[] = [];
  for (const step of steps) {
    attrs = step.apply(attrs);
    labels.push(step.label);
    const { groupSize, passes } = kAnonymity(attrs, COHORT, k);
    rungs.push({ added: step.added, shared: labels.join(", "), size: groupSize, passes });
  }

  const last = rungs[rungs.length - 1];
  const fullPasses = last?.passes ?? false;
  const passing = rungs.filter((rung) => rung.passes);
  const dropToReachK = fullPasses ? [] : kAnonymity(attrs, COHORT, k).offendingAttrs.map(attrName);
  return { rungs, fullPasses, shareableUpTo: passing.at(-1)?.shared ?? null, dropToReachK, notes };
}

/** A person-friendly name for a cohort attribute key. */
function attrName(key: string): string {
  const names: Record<string, string> = {
    roleFamily: "role",
    startLevel: "level",
    endLevel: "goal",
    region: "region",
    companyType: "company type",
  };
  return names[key] ?? key;
}

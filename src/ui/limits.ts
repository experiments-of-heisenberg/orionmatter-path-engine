/**
 * limits.ts: the person's constraints as the controls see them.
 *
 * The What-if panel edits one `Constraints` object. These pure helpers turn a slider position into a
 * value and back, make every edit immutable and normalised (an "off" switch removes the key instead of
 * storing `false`, so two equal settings are always `===`-comparable field by field), and describe the
 * settings in words for chips and screen readers. No React here, so all of it is tested directly.
 */
import { MAX_SKILLS } from "../lib/limits";
import type { Constraints } from "../lib/schemas";
import type { Relaxation } from "../lib/whatif";
import { clip } from "./text";

/** Shortest time limit the slider offers, in months. Typing into the chat can go lower (down to 1). */
export const LIMIT_MIN = 6;
/** Longest time limit the slider offers; one step further means "no limit". */
export const LIMIT_MAX = 72;
/** The slider position that means "no time limit". */
export const NO_LIMIT = LIMIT_MAX + 1;

/** Pay bands, lowest first. */
export const BAND_OPTIONS = ["B1", "B2", "B3", "B4", "B5"] as const;
export type Band = (typeof BAND_OPTIONS)[number];

/** Risk tolerance options, with the word shown for each. */
export const RISK_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

/** The slider position for a limit. No limit is the last position; a limit outside the slider's range sits at the nearest end. */
export function limitToSlider(months: number | undefined): number {
  if (months === undefined || !Number.isFinite(months)) return NO_LIMIT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(months)));
}

/** The limit a slider position means, or undefined for "no limit". */
export function sliderToLimit(position: number): number | undefined {
  if (!Number.isFinite(position) || position >= NO_LIMIT) return undefined;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(position)));
}

/** "No limit", "1 month" or "24 months". */
export function limitLabel(months: number | undefined): string {
  if (months === undefined || !Number.isFinite(months)) return "No limit";
  if (months === 1) return "1 month";
  return `${months} months`;
}

/** A copy of the constraints without the keys whose value is the same as "not set". */
export function normalise(c: Constraints): Constraints {
  const out: Constraints = { riskTolerance: c.riskTolerance, addSkills: [...c.addSkills] };
  if (c.remote === true) out.remote = true;
  if (c.noRelocation === true) out.noRelocation = true;
  if (c.minCompBand !== undefined) out.minCompBand = c.minCompBand;
  if (c.maxMonths !== undefined) out.maxMonths = c.maxMonths;
  return out;
}

/** Set or clear the time limit. */
export function withLimit(c: Constraints, months: number | undefined): Constraints {
  if (months !== undefined && !Number.isFinite(months)) return normalise(c); // not a number of months: change nothing
  const next = { ...c };
  if (months === undefined) delete next.maxMonths;
  else next.maxMonths = Math.min(240, Math.max(1, Math.round(months)));
  return normalise(next);
}

/** Set or clear the pay floor. */
export function withMinBand(c: Constraints, band: Band | undefined): Constraints {
  const next = { ...c };
  if (band === undefined) delete next.minCompBand;
  else next.minCompBand = band;
  return normalise(next);
}

/** Turn "remote only" or "no relocation" on or off. */
export function withFlag(c: Constraints, flag: "remote" | "noRelocation", on: boolean): Constraints {
  const next = { ...c };
  if (on) next[flag] = true;
  else delete next[flag];
  return normalise(next);
}

/** Change how much risk the person accepts. */
export function withRisk(c: Constraints, risk: Constraints["riskTolerance"]): Constraints {
  return normalise({ ...c, riskTolerance: risk });
}

/** A skill name as the engine expects it: trimmed, lower-case, one line, at most 40 characters. */
export function cleanSkill(raw: string): string {
  return clip(raw.replace(/\s+/g, " ").trim().toLowerCase(), 40);
}

/** Add a skill to ask about. Ignores blanks and repeats, and stops at the limit. */
export function withSkillAdded(c: Constraints, raw: string): Constraints {
  const skill = cleanSkill(raw);
  if (skill === "" || c.addSkills.includes(skill) || c.addSkills.length >= MAX_SKILLS) return normalise(c);
  return normalise({ ...c, addSkills: [...c.addSkills, skill] });
}

/** Stop asking about a skill. */
export function withSkillRemoved(c: Constraints, skill: string): Constraints {
  return normalise({ ...c, addSkills: c.addSkills.filter((s) => s !== skill) });
}

/** True when two settings mean the same thing. */
export function sameConstraints(a: Constraints, b: Constraints): boolean {
  const x = normalise(a);
  const y = normalise(b);
  return (
    x.remote === y.remote &&
    x.noRelocation === y.noRelocation &&
    x.minCompBand === y.minCompBand &&
    x.maxMonths === y.maxMonths &&
    x.riskTolerance === y.riskTolerance &&
    x.addSkills.length === y.addSkills.length &&
    x.addSkills.every((skill, i) => skill === y.addSkills[i])
  );
}

/** The settings in words, one short phrase each, for chips and for scenario cards. Empty when nothing is set. */
export function describeConstraints(c: Constraints): string[] {
  const out: string[] = [];
  if (c.maxMonths !== undefined) out.push(`Within ${limitLabel(c.maxMonths)}`);
  if (c.minCompBand !== undefined) out.push(`Pay ${c.minCompBand} or higher`);
  if (c.remote) out.push("Remote only");
  if (c.noRelocation) out.push("No relocation");
  if (c.riskTolerance !== "medium") out.push(`${c.riskTolerance === "low" ? "Low" : "High"} risk tolerance`);
  for (const skill of c.addSkills) out.push(`Asking about ${skill}`);
  return out;
}

/** Apply one "what would it take" suggestion to the current settings. */
export function applyRelaxation(c: Constraints, r: Pick<Relaxation, "knob" | "value">): Constraints {
  switch (r.knob) {
    case "maxMonths":
      return typeof r.value === "number" ? withLimit(c, r.value) : c;
    case "minCompBand":
      if (r.value === null) return withMinBand(c, undefined);
      return BAND_OPTIONS.find((b) => b === r.value) ? withMinBand(c, r.value as Band) : c;
    case "remote":
    case "noRelocation":
      return withFlag(c, r.knob, false); // a relaxation of a switch always turns it off
    default:
      return c; // an unknown knob (the type forbids it, but data from a server is only as good as its version)
  }
}

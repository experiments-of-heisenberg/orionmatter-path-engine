/**
 * validate.ts: turn the model's reading into a Draft, with code deciding every field.
 *
 * The model proposes values with the words it read them from. Code accepts a value only when:
 *   - TEXT: the quoted words really appear in what the person wrote (whole words, case-insensitive),
 *     and the value agrees with the quote (a level label must be IN the quote; a number must be in it)
 *   - IMAGE: the words cannot be checked, so the field is marked "image" and the person must confirm
 *   - ALWAYS: the value is on the allowed list (role family, level ladder, regions, bands), in range,
 *     and well-formed (quarters, skill names)
 * Anything refused is listed in `discarded` with a reason. Nothing is guessed and nothing is calculated
 * from the model's own arithmetic: "since 2018" never becomes "8 years".
 */
import { phraseInText, normalizeSkill } from "../whatif/apply";
import { numbersIn } from "../skeptic/textChecks";
import { COHORT, LEVEL_MAP } from "../tools/data";
import { levelMap } from "../tools/levelMap";
import { BANDS } from "../tools/stats";
import type { Draft, IntakeModelOutput, Provenance } from "./schemas";

/** The regions the cohort covers. */
export const REGIONS: readonly string[] = [...new Set(COHORT.map((r) => r.region))].sort();
/** The canonical level ladder. */
export const LEVELS: readonly string[] = LEVEL_MAP.levels;
/** Most stack entries kept. */
export const MAX_STACK = 15;
/** Most milestones kept (the shared Profile schema allows 20). */
export const MAX_MILESTONES = 20;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
};

/** Where the words come from: the person's text (checkable) or an image (not checkable). */
export type Source = "text" | "image";

/** The result of validating one model reading. */
export interface Validated {
  draft: Draft;
  provenance: Record<string, Provenance>;
  discarded: string[];
}

/** Find a company or title in the level table ignoring case, so "bigtech a" still matches "BigTech A". */
function canonicalKey(table: Record<string, unknown>, raw: string): string | undefined {
  const wanted = raw.trim().toLowerCase();
  return Object.keys(table).find((key) => key.toLowerCase() === wanted);
}

/** True when `years` is the number the quote actually states (digits or a number word). */
function quoteStatesNumber(quote: string, value: number): boolean {
  const digits = numbersIn(quote);
  if (digits.length > 0) return digits.includes(value);
  return quote
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => NUMBER_WORDS[word] === value);
}

/**
 * Validate a model reading.
 *
 * @param output the model's reading
 * @param text   the (already redacted) text the person wrote, or undefined for an image
 */
export function validateReading(output: IntakeModelOutput, text: string | undefined): Validated {
  const source: Source = text === undefined ? "image" : "text";
  const draft: Draft = { stack: [], milestones: [] };
  const provenance: Record<string, Provenance> = {};
  const discarded: string[] = [];

  /** True when the quote is in the person's words (always true for an image, which cannot be checked). */
  const grounded = (quote: string): boolean => text === undefined || phraseInText(quote, text);
  const refuse = (field: string, reason: string): void => void discarded.push(`${field}: ${reason}`);
  const accept = (field: string, quote: string, via?: string): void => {
    provenance[field] = {
      source: via ? "mapped" : source,
      ...(source === "text" ? { quote } : {}),
      ...(via ? { via } : {}),
    };
  };

  // ---- role family ----
  if (output.roleFamily) {
    if (grounded(output.roleFamily.quote)) {
      draft.roleFamily = output.roleFamily.value;
      accept("roleFamily", output.roleFamily.quote);
    } else refuse("roleFamily", "the quoted words are not in what you wrote.");
  }

  // ---- level: a label stated literally, or a company and title the level table knows ----
  if (output.level) {
    const label = output.level.value.trim().toUpperCase();
    if (!LEVELS.includes(label))
      refuse(
        "level",
        `"${output.level.value.slice(0, 10)}" is not on the level ladder (${LEVELS.join(", ")}).`,
      );
    else if (!grounded(output.level.quote)) refuse("level", "the quoted words are not in what you wrote.");
    else if (text !== undefined && !phraseInText(label, output.level.quote))
      refuse("level", `the quote does not contain the level ${label}.`);
    else {
      draft.level = label;
      accept("level", output.level.quote);
    }
  }
  if (draft.level === undefined && output.company && output.title) {
    const system = canonicalKey(LEVEL_MAP.systems, output.company.value);
    const title = system ? canonicalKey(LEVEL_MAP.systems[system] ?? {}, output.title.value) : undefined;
    const mapped = system && title ? levelMap(system, title).canonicalLevel : null;
    if (!grounded(output.company.quote) || !grounded(output.title.quote))
      refuse("level", "the company or title is not in what you wrote.");
    else if (mapped) {
      draft.level = mapped;
      accept("level", `${output.title.quote} / ${output.company.quote}`, `${system} / ${title}`);
    } else
      refuse(
        "level",
        "titles differ between companies, so this company and title cannot be mapped to a level without guessing.",
      );
  }

  // ---- years of experience: the number the quote states, never one calculated from dates ----
  if (output.yearsExperience) {
    const { value, quote } = output.yearsExperience;
    if (!Number.isFinite(value) || value < 0 || value > 40)
      refuse("yearsExperience", `${value} is outside 0 to 40 years.`);
    else if (!grounded(quote)) refuse("yearsExperience", "the quoted words are not in what you wrote.");
    else if (text !== undefined && !quoteStatesNumber(quote, value)) {
      refuse(
        "yearsExperience",
        `the quote does not state ${value} years; a number worked out from dates is not used.`,
      );
    } else {
      draft.yearsExperience = value;
      accept("yearsExperience", quote);
    }
  }

  // ---- region: one the cohort covers ----
  if (output.region) {
    const region = REGIONS.find((r) => r.toLowerCase() === output.region?.value.trim().toLowerCase());
    if (!region)
      refuse(
        "region",
        `"${output.region.value.slice(0, 20)}" is not a region the data covers (${REGIONS.join(", ")}).`,
      );
    else if (!grounded(output.region.quote)) refuse("region", "the quoted words are not in what you wrote.");
    else {
      draft.region = region;
      accept("region", output.region.quote);
    }
  }

  // ---- pay band: only a band the text states ----
  if (output.compBand) {
    const band = output.compBand.value.trim().toUpperCase();
    if (!(BANDS as readonly string[]).includes(band))
      refuse("compBand", `"${output.compBand.value.slice(0, 4)}" is not a pay band (B1 to B5).`);
    else if (
      !grounded(output.compBand.quote) ||
      (text !== undefined && !phraseInText(band, output.compBand.quote))
    ) {
      refuse("compBand", "the text does not state that band.");
    } else {
      draft.compBand = band;
      accept("compBand", output.compBand.quote);
    }
  }

  // ---- stack: each item must appear in the text and look like a skill ----
  const seen = new Set<string>();
  for (const raw of output.stack) {
    const skill = normalizeSkill(raw);
    if (!skill) refuse("stack", `"${raw.slice(0, 30)}" is not a recognisable skill name.`);
    else if (text !== undefined && !phraseInText(skill, text))
      refuse("stack", `"${skill}" is not in what you wrote.`);
    else if (!seen.has(skill) && draft.stack.length < MAX_STACK) {
      seen.add(skill);
      draft.stack.push(skill);
    }
  }
  if (draft.stack.length > 0) provenance["stack"] = { source };

  // ---- milestones: well-formed quarter, grounded quote, always unverified ----
  for (const m of output.milestones) {
    if (draft.milestones.length >= MAX_MILESTONES) break;
    const year = /^(\d{4})-Q[1-4]$/.exec(m.quarter)?.[1];
    if (!year) refuse("milestones", `"${m.quarter.slice(0, 10)}" is not a quarter like 2025-Q3.`);
    else if (!grounded(m.quote)) refuse("milestones", "the quoted words are not in what you wrote.");
    else if (text !== undefined && !m.quote.includes(year))
      refuse("milestones", `the quote does not mention ${year}.`);
    else draft.milestones.push({ type: m.type, quarter: m.quarter, note: m.note, verified: false });
  }
  if (draft.milestones.length > 0) provenance["milestones"] = { source };

  // ---- goal ----
  if (output.goal) {
    const target = output.goal.targetLevel.trim().toUpperCase();
    if (!LEVELS.includes(target))
      refuse("goal", `"${output.goal.targetLevel.slice(0, 10)}" is not on the level ladder.`);
    else if (!grounded(output.goal.quote)) refuse("goal", "the quoted words are not in what you wrote.");
    else {
      draft.goal = { targetLevel: target, label: output.goal.label.trim().slice(0, 60) || target };
      accept("goal", output.goal.quote);
    }
  }

  return { draft, provenance, discarded };
}

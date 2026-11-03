/**
 * apply.ts: turn the model's PROPOSED changes into validated constraints.
 *
 * The model proposes; this module decides. Everything the model sends is untrusted, so each
 * value is checked here, and the results are explained in terms a person can read:
 *   - changes whose quoted phrase is not in the user's message are discarded (hallucination guard)
 *   - out-of-range or malformed values are refused with a reason, not silently clamped
 *   - two changes that fight over the same field are detected HERE, by code, and neither is
 *     applied: we do not rely on the model to notice its own contradiction
 *   - a change that would not alter anything is noted, not reported as a change
 */
import { Constraints } from "../schemas";
import type { Constraints as ConstraintsType } from "../schemas";
import type { AppliedChange, ChangeField, Contradiction, ModelChange, RefusedChange } from "./schemas";

/** Allowed range for a time limit, in months. Below 6 or above 120 is not a meaningful career plan. */
export const MONTHS_RANGE = { min: 6, max: 120 } as const;
/** Most extra skills a person can ask about at once. */
export const MAX_SKILLS = 5;

/**
 * Words that are never part of a real skill name but are typical of prompt-injection strings.
 * Skills are only ever data inside a labelled block, so this is a second wall, not the first.
 */
const INSTRUCTION_WORDS: ReadonlySet<string> = new Set([
  "ignore",
  "disregard",
  "forget",
  "override",
  "previous",
  "instructions",
  "instruction",
  "system",
  "prompt",
  "assistant",
  "developer",
  "jailbreak",
  "pretend",
]);

/** Human-readable name of each field, for display. */
const LABELS: Record<ChangeField, string> = {
  remote: "Remote only",
  noRelocation: "No relocation",
  minCompBand: "Minimum pay band",
  maxMonths: "Time limit",
  riskTolerance: "Risk tolerance",
  skills: "Skills to add",
};

/** Normalise whitespace and case so a quote still matches if re-wrapped or re-cased. */
const normalise = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * True when `phrase` appears in the text the user actually wrote.
 * The hallucination guard: a change quoting words the user never said is discarded.
 */
export function phraseInText(phrase: string, userText: string): boolean {
  const needle = normalise(phrase);
  if (needle.length === 0) return false;
  // Whole-word match: a short quote such as "go" must not be "found" inside "goal".
  // Unicode-aware, so "caf" does not match inside "café" either.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(normalise(userText));
}

/**
 * A skill name in canonical form (lower-case, trimmed), or undefined when it is not a plausible skill.
 * A skill is one or two short words ("rust", "machine learning", "c++"). Anything longer or with
 * unusual characters is rejected, so a sentence-like prompt-injection string can never become a "skill".
 */
export function normalizeSkill(raw: string): string | undefined {
  const skill = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (skill.length > 24 || !/^[a-z0-9][a-z0-9+#.-]*(?: [a-z0-9+#.-]+)?$/.test(skill)) return undefined;
  // A skill has at least one letter: "123" is a number, not a skill.
  if (!/[a-z]/.test(skill)) return undefined;
  // Defence in depth: a two-word instruction ("ignore previous") fits the shape above, so words
  // that only make sense as an instruction to a model are refused outright.
  if (skill.split(" ").some((word) => INSTRUCTION_WORDS.has(word))) return undefined;
  return skill;
}

/** Show a constraint value for people: booleans as on/off, bands as-is, months with a unit. */
function show(field: ChangeField, constraints: ConstraintsType): string {
  switch (field) {
    case "remote":
      return constraints.remote ? "on" : "off";
    case "noRelocation":
      return constraints.noRelocation ? "on" : "off";
    case "minCompBand":
      return constraints.minCompBand ?? "not set";
    case "maxMonths":
      return constraints.maxMonths === undefined ? "not set" : `${constraints.maxMonths} months`;
    case "riskTolerance":
      return constraints.riskTolerance;
    case "skills":
      return constraints.addSkills.length > 0 ? constraints.addSkills.join(", ") : "none";
  }
}

/** The result of applying a batch of proposed changes. */
export interface ApplyResult {
  next: ConstraintsType;
  applied: AppliedChange[];
  refused: RefusedChange[];
  /** Contradictions detected by code: fields where the changes disagree. Their changes were NOT applied. */
  contradictions: Contradiction[];
  /** Observations such as "already set". */
  notes: string[];
}

/** Stable text for comparing two proposed values for the same field. */
const valueKey = (change: ModelChange): string =>
  change.field === "skills"
    ? `${change.action}:${[...change.value]
        .map((s) => s.trim().toLowerCase())
        .sort()
        .join(",")}`
    : JSON.stringify(change.value);

/**
 * Find fields on which the proposed changes disagree.
 *
 * For ordinary fields: two different values. For skills: the same skill both added and removed.
 */
function findContradictions(changes: readonly ModelChange[]): Contradiction[] {
  const found: Contradiction[] = [];

  const byField = new Map<ChangeField, ModelChange[]>();
  for (const change of changes) {
    if (change.field === "skills") continue;
    byField.set(change.field, [...(byField.get(change.field) ?? []), change]);
  }
  for (const [field, group] of byField) {
    if (new Set(group.map(valueKey)).size > 1) {
      found.push({
        fields: [field],
        phrases: group.map((change) => change.phrase),
        description: `You asked for conflicting things about "${LABELS[field].toLowerCase()}".`,
      });
    }
  }

  const added = new Map<string, string>();
  const removed = new Map<string, string>();
  for (const change of changes) {
    if (change.field !== "skills") continue;
    const target = change.action === "add" ? added : removed;
    for (const raw of change.value) {
      const skill = normalizeSkill(raw);
      if (skill) target.set(skill, change.phrase);
    }
  }
  for (const [skill, phrase] of added) {
    const removedPhrase = removed.get(skill);
    if (removedPhrase !== undefined) {
      found.push({
        fields: ["skills"],
        phrases: [phrase, removedPhrase],
        description: `You asked to both add and remove the skill "${skill}".`,
      });
    }
  }
  return found;
}

/**
 * Validate and apply proposed changes to the current constraints.
 *
 * @param current the constraints before this What-if message
 * @param changes changes the model proposed (already filtered by the quote guard)
 */
export function applyChanges(current: ConstraintsType, changes: readonly ModelChange[]): ApplyResult {
  const contradictions = findContradictions(changes);
  const blocked = new Set<ChangeField>(contradictions.flatMap((c) => c.fields));

  const next: ConstraintsType = { ...current, addSkills: [...current.addSkills] };
  const applied: AppliedChange[] = [];
  const refused: RefusedChange[] = [];
  const notes: string[] = [];
  const seen = new Set<string>(); // drop exact duplicates the model repeated

  for (const change of changes) {
    if (blocked.has(change.field)) continue; // disagreed with itself: ask, do not guess
    if (change.field === "skills" && change.value.length === 0) continue; // nothing to add or remove
    const key = `${change.field}|${valueKey(change)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const before = show(change.field, next);
    const notesBefore = notes.length;
    const refuse = (reason: string) => refused.push({ field: change.field, phrase: change.phrase, reason });

    switch (change.field) {
      case "remote":
        next.remote = change.value;
        break;
      case "noRelocation":
        next.noRelocation = change.value;
        break;
      case "riskTolerance":
        next.riskTolerance = change.value;
        break;
      case "minCompBand":
        if (change.value === null) delete next.minCompBand;
        else next.minCompBand = change.value;
        break;
      case "maxMonths":
        if (change.value === null) {
          delete next.maxMonths;
        } else if (change.value < MONTHS_RANGE.min || change.value > MONTHS_RANGE.max) {
          refuse(
            `${change.value} months is outside the supported range of ${MONTHS_RANGE.min} to ${MONTHS_RANGE.max} months.`,
          );
          continue;
        } else {
          next.maxMonths = change.value;
        }
        break;
      case "skills": {
        for (const raw of change.value) {
          const skill = normalizeSkill(raw);
          if (!skill) {
            refuse(`"${raw.slice(0, 30)}" is not a recognisable skill name.`);
          } else if (change.action === "add") {
            if (next.addSkills.includes(skill)) notes.push(`"${skill}" was already in your skills list.`);
            else if (next.addSkills.length >= MAX_SKILLS)
              refuse(`You can ask about at most ${MAX_SKILLS} skills at once; "${skill}" was not added.`);
            else next.addSkills.push(skill);
          } else if (next.addSkills.includes(skill)) {
            next.addSkills = next.addSkills.filter((existing) => existing !== skill);
          } else {
            refuse(`"${skill}" is not in your skills list, so there is nothing to remove.`);
          }
        }
        break;
      }
    }

    const after = show(change.field, next);
    if (before === after) {
      // Add the generic "already" note only if this change did not already explain itself
      // (a repeated skill adds its own, more specific note).
      if (notes.length === notesBefore && !notes.some((note) => note.includes(LABELS[change.field]))) {
        notes.push(`${LABELS[change.field]} was already ${after}.`);
      }
    } else {
      // Merge repeated changes to the same field (e.g. two skills) into one line.
      const existing = applied.find((item) => item.field === change.field);
      if (existing) {
        existing.to = after;
        existing.phrase = `${existing.phrase}; ${change.phrase}`;
      } else {
        applied.push({
          field: change.field,
          label: LABELS[change.field],
          from: before,
          to: after,
          phrase: change.phrase,
        });
      }
    }
  }

  // Final safety net: the result must still satisfy the schema, whatever happened above.
  return { next: Constraints.parse(next), applied, refused, contradictions, notes };
}

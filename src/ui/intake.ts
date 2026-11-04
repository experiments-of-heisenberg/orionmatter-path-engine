/**
 * intake.ts: the "Your story" tab as plain data.
 *
 * A person pastes a few lines about their career, or uploads a cropped screenshot. The server reads it and returns a
 * draft with, for each field, where it came from. The screen shows that draft as an editable form, never as fact:
 * nothing is verified, and the person confirms (or corrects) every field before any route is computed from it.
 * This module checks inputs before they are sent, words each field's provenance, edits the draft, and turns a
 * confirmed draft into the person the rest of the app uses. All pure, so all tested without a browser.
 */
import type { Draft, IntakeResult, Provenance } from "../lib/intake";
import type { Goal, Profile } from "../lib/schemas";
import { clip } from "./text";
import { type Person, ROLE_LABEL } from "./sample";

/** Longest text the server reads. Kept equal to the server's limit by a test. */
export const MAX_INTAKE = 6000;
/** Largest image accepted, in bytes. Kept equal to the server's limit by a test. */
export const MAX_IMAGE = 4 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The level ladder and the regions the data covers. Kept equal to the server's by a test. */
export const LEVEL_OPTIONS = ["L3", "L4", "L5", "L6", "L7", "EM1", "EM2"] as const;
export const REGION_OPTIONS = ["EU-west", "IN-south", "SEA", "US-east", "US-west"] as const;
export const ROLE_OPTIONS = Object.keys(ROLE_LABEL) as Profile["roleFamily"][];

/** The words used for a goal at each level (a display name only; the data uses the level). */
export const GOAL_LABEL: Readonly<Record<string, string>> = {
  L3: "Engineer",
  L4: "Mid-level Engineer",
  L5: "Senior Engineer",
  L6: "Staff Engineer",
  L7: "Principal Engineer",
  EM1: "Engineering Manager",
  EM2: "Senior Engineering Manager",
};

/** What a person may type or upload. */
export interface IntakeInput {
  text: string;
  image: { name: string; dataUrl: string } | undefined;
}

/** Check what is about to be sent. Needs words or a picture; the text may not be too long. */
export function checkIntakeInput(
  input: IntakeInput,
): { ok: true; text: string } | { ok: false; message: string } {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const text = input.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (text === "" && !input.image) {
    return { ok: false, message: "Write a few lines about your career, or upload a cropped screenshot." };
  }
  if (text.length > MAX_INTAKE) {
    return { ok: false, message: `That is ${text.length} characters. Please keep it under ${MAX_INTAKE}.` };
  }
  return { ok: true, text };
}

/** Check a chosen file before reading it: a picture type we accept, not too large, not empty. */
export function checkImageFile(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; message: string } {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: "Please choose a PNG, JPEG or WebP picture." };
  }
  if (file.size === 0) return { ok: false, message: "That file is empty." };
  if (file.size > MAX_IMAGE) {
    return {
      ok: false,
      message: `That picture is ${(file.size / 1048576).toFixed(1)} MB. The most we can read is 4 MB.`,
    };
  }
  return { ok: true };
}

/** The warning shown before any screenshot is chosen. It is about what the model will see. */
export const CROP_WARNING =
  "Crop your screenshot to only the career details you want read, such as titles, companies and dates. A picture is sent to the model exactly as it is: we cannot remove names, photos or contact details inside it. Text you type has emails, phone numbers and links removed first.";

/** Words for where a field came from. */
export function provenanceText(p: Provenance | undefined): string {
  if (!p) return "Entered by you";
  switch (p.source) {
    case "text":
      return p.quote ? `From your words: \u201c${p.quote}\u201d` : "From your words";
    case "image":
      return "Read from your screenshot. Please check it.";
    case "earlier":
      return "From your earlier answer";
    case "mapped":
      return p.via ? `Worked out from ${p.via}` : "Worked out from what you wrote";
  }
}

/** The form's values. Everything is a string or a list so a half-filled form is representable. */
export interface FormValues {
  roleFamily: string;
  level: string;
  /** Typed, so "" and "7" and "7.5" are all possible while editing. */
  years: string;
  region: string;
  stack: string[];
  goalLevel: string;
  goalLabel: string;
  compBand: string;
  milestones: Draft["milestones"];
}

export const EMPTY_FORM: FormValues = {
  roleFamily: "",
  level: "",
  years: "",
  region: "",
  stack: [],
  goalLevel: "",
  goalLabel: "",
  compBand: "",
  milestones: [],
};

/** The form for a draft. Missing fields stay empty rather than guessed. */
export function formFromDraft(draft: Draft): FormValues {
  return {
    roleFamily: draft.roleFamily ?? "",
    level: draft.level ?? "",
    years: draft.yearsExperience === undefined ? "" : String(draft.yearsExperience),
    region: draft.region ?? "",
    stack: [...draft.stack],
    goalLevel: draft.goal?.targetLevel ?? "",
    goalLabel: draft.goal?.label ?? "",
    compBand: draft.compBand ?? "",
    milestones: draft.milestones,
  };
}

/** The field names a person must fill before routes can be computed, and their words. */
export const REQUIRED_WORDS = {
  roleFamily: "Role",
  level: "Current level",
  years: "Years of experience",
  region: "Region",
  goalLevel: "Goal level",
} as const;

/** Set the goal level and, when the label is empty or still the old level's default, its default words. */
export function withGoalLevel(form: FormValues, level: string): FormValues {
  const oldDefault = GOAL_LABEL[form.goalLevel];
  const label =
    form.goalLabel === "" || form.goalLabel === oldDefault ? (GOAL_LABEL[level] ?? "") : form.goalLabel;
  return { ...form, goalLevel: level, goalLabel: label };
}

/** Add a technology to the stack: trimmed, no repeats (ignoring case), at most 15, each at most 40 characters. */
export function withStackAdded(form: FormValues, raw: string): FormValues {
  const item = clip(raw.replace(/\s+/g, " ").trim(), 40);
  if (
    item === "" ||
    form.stack.length >= 15 ||
    form.stack.some((s) => s.toLowerCase() === item.toLowerCase())
  )
    return form;
  return { ...form, stack: [...form.stack, item] };
}

/** Remove a technology from the stack. */
export function withStackRemoved(form: FormValues, item: string): FormValues {
  return { ...form, stack: form.stack.filter((s) => s !== item) };
}

export type ConfirmResult = { ok: true; person: Person } | { ok: false; problems: string[] };

/**
 * Turn the form into the person the app uses, or list what is wrong in words. Required fields must be present
 * and valid: a role, a level and goal level on the ladder, years from 0 to 40 (whole or half), a region the data covers.
 */
export function personFromForm(form: FormValues): ConfirmResult {
  const problems: string[] = [];
  const need = (ok: boolean, key: keyof typeof REQUIRED_WORDS, why: string): void => {
    if (!ok) problems.push(`${REQUIRED_WORDS[key]}: ${why}`);
  };
  const role = ROLE_OPTIONS.find((r) => r === form.roleFamily);
  need(role !== undefined, "roleFamily", "choose one.");
  need((LEVEL_OPTIONS as readonly string[]).includes(form.level), "level", "choose one from the list.");
  need((REGION_OPTIONS as readonly string[]).includes(form.region), "region", "choose one the data covers.");
  need(
    (LEVEL_OPTIONS as readonly string[]).includes(form.goalLevel),
    "goalLevel",
    "choose one from the list.",
  );
  const years = form.years.trim() === "" ? Number.NaN : Number(form.years);
  need(
    Number.isFinite(years) && years >= 0 && years <= 40 && years * 2 === Math.round(years * 2),
    "years",
    "a number from 0 to 40, in whole or half years.",
  );
  if (problems.length > 0 || role === undefined) return { ok: false, problems };
  const goal: Goal = {
    targetLevel: form.goalLevel,
    label: clip(form.goalLabel.trim() || (GOAL_LABEL[form.goalLevel] ?? form.goalLevel), 60),
  };
  const profile: Profile = {
    roleFamily: role,
    level: form.level,
    yearsExperience: years,
    stack: form.stack.slice(0, 15),
    region: form.region,
    ...(/^B[1-5]$/.test(form.compBand) ? { compBand: form.compBand } : {}),
    milestones: form.milestones.slice(0, 20),
  };
  return { ok: true, person: { profile, goal, constraints: { riskTolerance: "medium", addSkills: [] } } };
}

/** Which required fields are still empty, for a short "still needed" line. */
export function missingFields(form: FormValues): (keyof typeof REQUIRED_WORDS)[] {
  const out: (keyof typeof REQUIRED_WORDS)[] = [];
  if (form.roleFamily === "") out.push("roleFamily");
  if (form.level === "") out.push("level");
  if (form.years.trim() === "") out.push("years");
  if (form.region === "") out.push("region");
  if (form.goalLevel === "") out.push("goalLevel");
  return out;
}

/** The request body for the intake route: text and or an image, and the earlier draft when answering a question. */
export function intakeBody(
  input: { text: string; image: IntakeInput["image"] },
  previous: Pick<IntakeResult, "draft" | "provenance"> | undefined,
): {
  text?: string;
  imageDataUrl?: string;
  previous?: { draft: Draft; provenance: Record<string, Provenance> };
} {
  return {
    ...(input.text !== "" ? { text: input.text } : {}),
    ...(input.image ? { imageDataUrl: input.image.dataUrl } : {}),
    ...(previous ? { previous: { draft: previous.draft, provenance: previous.provenance } } : {}),
  };
}

/** The provenance key each form field belongs to. */
const KEY_OF: Readonly<Record<keyof FormValues, string>> = {
  roleFamily: "roleFamily",
  level: "level",
  years: "yearsExperience",
  region: "region",
  stack: "stack",
  goalLevel: "goal",
  goalLabel: "goal",
  compBand: "compBand",
  milestones: "milestones",
};

/** Which provenance keys the person has changed since the server's draft, by comparing the form with the original. */
export function editedKeys(original: FormValues, form: FormValues): Set<string> {
  const changed = new Set<string>();
  for (const field of Object.keys(KEY_OF) as (keyof FormValues)[]) {
    if (JSON.stringify(original[field]) !== JSON.stringify(form[field])) changed.add(KEY_OF[field]);
  }
  return changed;
}

/** The words for where a form field came from, saying "Entered by you" for anything the person has typed or changed. */
export function fieldSource(
  key: string,
  provenance: Record<string, Provenance>,
  edited: ReadonlySet<string>,
): string {
  return edited.has(key) ? "Entered by you" : provenanceText(provenance[key]);
}

/**
 * The draft to send back with an answer to a question: the form's valid fields, so nothing the person has already
 * corrected is lost, and the provenance of only the fields they have not changed.
 */
export function previousFrom(
  result: Pick<IntakeResult, "draft" | "provenance">,
  form: FormValues,
): { draft: Draft; provenance: Record<string, Provenance> } {
  const edited = editedKeys(formFromDraft(result.draft), form);
  const years = form.years.trim() === "" ? Number.NaN : Number(form.years);
  const role = ROLE_OPTIONS.find((r) => r === form.roleFamily);
  const draft: Draft = {
    ...(role ? { roleFamily: role } : {}),
    ...((LEVEL_OPTIONS as readonly string[]).includes(form.level) ? { level: form.level } : {}),
    ...(Number.isFinite(years) && years >= 0 && years <= 40 ? { yearsExperience: years } : {}),
    ...((REGION_OPTIONS as readonly string[]).includes(form.region) ? { region: form.region } : {}),
    ...(/^B[1-5]$/.test(form.compBand) ? { compBand: form.compBand } : {}),
    stack: form.stack.slice(0, 15),
    milestones: form.milestones.slice(0, 20),
    ...((LEVEL_OPTIONS as readonly string[]).includes(form.goalLevel)
      ? {
          goal: {
            targetLevel: form.goalLevel,
            label: clip(form.goalLabel.trim() || (GOAL_LABEL[form.goalLevel] ?? form.goalLevel), 60),
          },
        }
      : {}),
  };
  const provenance: Record<string, Provenance> = {};
  for (const [key, value] of Object.entries(result.provenance)) {
    if (!edited.has(key)) provenance[key] = value;
  }
  return { draft, provenance };
}

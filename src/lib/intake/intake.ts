/**
 * intake.ts: the Intake agent. A person's own words, or a screenshot, become a draft profile.
 *
 *   text / image  ->  sanitise and redact  ->  MODEL reads  ->  validate (code decides)
 *                 ->  merge with earlier turns  ->  what is missing, questions, warnings
 *
 * What it will not do: verify anything (the result says `verified: false`), guess a missing
 * required field (it asks), or send an email address, phone number or link to a model.
 * The interface must show the draft for the person to confirm or correct before a plan is made.
 */
import { noEmit, type Emit } from "../agents/events";
import { chatStructured, type ContentPart, type ModelClient, type ReasoningEffort } from "../model";
import { Goal, Profile } from "../schemas";
import { COHORT, THIN_N } from "../tools/data";
import { findTwins } from "../tools/findTwins";
import { levelRank } from "../tools/levels";
import { validateImage } from "./image";
import { INTAKE_IMAGE_INSTRUCTION, INTAKE_SYSTEM_PROMPT, intakeTextMessage } from "./prompts";
import { redactPii, type Redactions } from "./redact";
import {
  IntakeModelOutput,
  REQUIRED_FIELDS,
  type Draft,
  type IntakeResult,
  type Provenance,
  type RequiredField,
} from "./schemas";
import { validateReading } from "./validate";

/** Longest pasted text accepted, in characters (about two pages). */
export const MAX_INTAKE_CHARS = 6000;

/** Thrown for input Intake will not process. */
export class IntakeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeInputError";
  }
}

/** What a previous turn left, passed back so a follow-up answer fills the gaps. */
export interface IntakeState {
  draft: Draft;
  provenance: Record<string, Provenance>;
}

export interface IntakeInput {
  /** Text the person pasted or typed (a bio, a resume, or an answer to a question). */
  text?: string;
  /** A resume or profile screenshot as a data URL. */
  imageDataUrl?: string;
  /** The result of the previous turn, when the person is answering a question. */
  previous?: IntakeState;
}

export interface IntakeDeps {
  client: ModelClient;
  emit?: Emit;
  effort?: ReasoningEffort;
}

/** Strip control characters (keeping newlines and tabs). */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/** Plain question for each required field. */
const QUESTIONS: Record<RequiredField, string> = {
  roleFamily: "Which kind of engineer are you: backend, platform, ml, frontend, embedded or sre?",
  level:
    "What is your level? Titles differ between companies, so please give it on this ladder: L3, L4, L5, L6, L7, EM1 or EM2.",
  yearsExperience: "How many years of engineering experience do you have?",
  region: "Where do you work? Our data covers IN-south, US-east, US-west, EU-west and SEA.",
};

/** Merge a newer reading over an earlier draft: newer values win; lists are combined without repeats. */
function merge(
  previous: IntakeState | undefined,
  next: { draft: Draft; provenance: Record<string, Provenance> },
): IntakeState {
  if (!previous) return next;
  const draft: Draft = {
    ...previous.draft,
    stack: [...previous.draft.stack],
    milestones: [...previous.draft.milestones],
  };
  const provenance: Record<string, Provenance> = {};
  for (const [field, value] of Object.entries(previous.provenance))
    provenance[field] = { ...value, source: value.source === "mapped" ? "mapped" : "earlier" };
  const take = (
    key: "roleFamily" | "level" | "yearsExperience" | "region" | "compBand" | "goal",
    apply: () => void,
  ): void => {
    if (next.draft[key] === undefined) return;
    apply();
    const p = next.provenance[key];
    if (p) provenance[key] = p;
  };
  take("roleFamily", () => void (draft.roleFamily = next.draft.roleFamily));
  take("level", () => void (draft.level = next.draft.level));
  take("yearsExperience", () => void (draft.yearsExperience = next.draft.yearsExperience));
  take("region", () => void (draft.region = next.draft.region));
  take("compBand", () => void (draft.compBand = next.draft.compBand));
  take("goal", () => void (draft.goal = next.draft.goal));
  for (const skill of next.draft.stack)
    if (!draft.stack.includes(skill) && draft.stack.length < 15) draft.stack.push(skill);
  for (const m of next.draft.milestones) {
    if (
      !draft.milestones.some((x) => x.quarter === m.quarter && x.type === m.type && x.note === m.note) &&
      draft.milestones.length < 20
    )
      draft.milestones.push(m);
  }
  if (draft.stack.length > 0)
    provenance["stack"] = next.provenance["stack"] ?? provenance["stack"] ?? { source: "earlier" };
  if (draft.milestones.length > 0)
    provenance["milestones"] = next.provenance["milestones"] ??
      provenance["milestones"] ?? { source: "earlier" };
  return { draft, provenance };
}

/** Goal levels the cohort has evidence for. */
const SUPPORTED_GOALS: readonly string[] = [...new Set(COHORT.map((r) => r.endLevel))].sort();

/** Cautions that depend on what was read. All written by code. */
function warningsFor(draft: Draft, profile: Profile | undefined, extra: string[]): string[] {
  const warnings = [...extra];
  if (draft.goal && !SUPPORTED_GOALS.includes(draft.goal.targetLevel)) {
    warnings.push(
      `The data has no engineers who reached ${draft.goal.targetLevel}; it covers ${SUPPORTED_GOALS.join(" and ")}, so a plan for that goal would have no evidence.`,
    );
  }
  if (profile && draft.goal) {
    const twins = findTwins(profile, draft.goal).n;
    if (twins === 0)
      warnings.push(
        "No comparable engineers in the data match this profile and goal, so there would be no evidence for any route.",
      );
    else if (twins < THIN_N)
      warnings.push(
        `Only ${twins} comparable engineers match this profile and goal, so every route would rest on limited evidence.`,
      );
  } else if (profile && levelRank(profile.level) === undefined) {
    warnings.push(`${profile.level} is not on the level ladder the data uses.`);
  }
  return warnings;
}

/** Read one input (text or image) with the model and validate it. */
async function readOnce(deps: IntakeDeps, kind: "text" | "image", payload: string) {
  const user: ContentPart[] | string =
    kind === "text"
      ? intakeTextMessage(payload)
      : [
          { type: "text", text: INTAKE_IMAGE_INSTRUCTION },
          { type: "image", dataUrl: payload },
        ];
  const { data } = await chatStructured(
    deps.client,
    {
      label: `intake:${kind}`,
      target: "spark",
      reasoningEffort: deps.effort ?? "minimal",
      maxCompletionTokens: 3000,
      messages: [
        { role: "system", content: INTAKE_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    },
    IntakeModelOutput,
  );
  return validateReading(data, kind === "text" ? payload : undefined);
}

/**
 * Turn what a person wrote (or a screenshot) into a draft profile.
 *
 * @throws IntakeInputError when there is neither text nor an image, or the text is too long
 * @throws IntakeImageError when the image is not acceptable
 * @throws ModelParseError if the model's output is invalid even after the repair retry
 */
export async function runIntake(deps: IntakeDeps, input: IntakeInput): Promise<IntakeResult> {
  const emit = deps.emit ?? noEmit;
  const text = input.text === undefined ? undefined : clean(input.text);
  if ((text === undefined || text.length === 0) && input.imageDataUrl === undefined) {
    throw new IntakeInputError("Write a few lines about your career, or upload a screenshot.");
  }
  if (text !== undefined && text.length > MAX_INTAKE_CHARS) {
    throw new IntakeInputError(
      `The text is too long (${text.length} characters; the limit is ${MAX_INTAKE_CHARS}).`,
    );
  }
  const image = input.imageDataUrl === undefined ? undefined : validateImage(input.imageDataUrl);
  emit({ type: "stage", stage: "reading" });

  let state: IntakeState | undefined = input.previous;
  const discarded: string[] = [];
  const warnings: string[] = [];
  let redactions: Redactions = { emails: 0, phones: 0, links: 0 };
  let anythingRead = false;

  if (text !== undefined && text.length > 0) {
    const redacted = redactPii(text);
    redactions = redacted.redactions;
    const total = redactions.emails + redactions.phones + redactions.links;
    if (total > 0) {
      warnings.push(
        `Removed ${redactions.emails} email address(es), ${redactions.phones} phone number(s) and ${redactions.links} link(s) before reading; a career plan does not need them. Names and employers are not removed.`,
      );
    }
    const read = await readOnce(deps, "text", redacted.text);
    discarded.push(...read.discarded);
    anythingRead ||= Object.keys(read.provenance).length > 0;
    state = merge(state, read);
  }
  if (image !== undefined) {
    warnings.push(
      "An image is sent to the model as it is: we cannot remove names or contact details inside it. Crop those out before uploading. Fields read from an image cannot be checked against your words, so please confirm each one.",
    );
    const read = await readOnce(deps, "image", image);
    discarded.push(...read.discarded);
    anythingRead ||= Object.keys(read.provenance).length > 0;
    state = merge(state, read);
  }

  const final: IntakeState = state ?? { draft: { stack: [], milestones: [] }, provenance: {} };
  const { draft } = final;
  const missing = REQUIRED_FIELDS.filter((field) => draft[field] === undefined);
  const hadEarlier = input.previous !== undefined && Object.keys(input.previous.provenance).length > 0;

  const profile =
    missing.length === 0
      ? Profile.parse({
          roleFamily: draft.roleFamily,
          level: draft.level,
          yearsExperience: draft.yearsExperience,
          stack: draft.stack,
          region: draft.region,
          ...(draft.compBand ? { compBand: draft.compBand } : {}),
          milestones: draft.milestones,
        })
      : undefined;
  const goal = draft.goal ? Goal.parse(draft.goal) : undefined;

  return {
    status: profile ? "complete" : anythingRead || hadEarlier ? "needs_info" : "nothing_found",
    draft,
    provenance: final.provenance,
    ...(profile ? { profile } : {}),
    ...(goal ? { goal } : {}),
    missing,
    questions: missing.map((field) => QUESTIONS[field]),
    discarded,
    warnings: warningsFor(draft, profile, warnings),
    redactions,
    verified: false,
  };
}

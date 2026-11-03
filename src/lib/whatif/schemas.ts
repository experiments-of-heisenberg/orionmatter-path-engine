/**
 * schemas.ts: the data shapes of the What-if interpreter.
 *
 * Two layers, deliberately separate:
 *   ModelOutput   what the MODEL returns: proposed changes, each quoting the user's words.
 *                 Loose where code can judge better (numbers are validated in code, so an
 *                 out-of-range value becomes a clear message, not a schema failure).
 *   Interpretation what CODE returns to the caller: validated changes, the new constraints,
 *                 what was refused and why, conflicts, and any question to ask the user.
 */
import { z } from "zod";
import type { Constraints } from "../schemas";
import { BANDS } from "../tools/stats";

/** Constraint fields the interpreter can change. `skills` covers both adding and removing. */
export const ChangeField = z.enum([
  "remote",
  "noRelocation",
  "minCompBand",
  "maxMonths",
  "riskTolerance",
  "skills",
]);
export type ChangeField = z.infer<typeof ChangeField>;

const Band = z.enum(BANDS);

/**
 * One change the model proposes. A discriminated union on `field`, so each field accepts only
 * its own kind of value. `phrase` must be words copied from the user's message; code verifies
 * that and discards changes whose phrase is not found (the hallucination guard).
 */
export const ModelChange = z.discriminatedUnion("field", [
  z.object({ field: z.literal("remote"), value: z.boolean(), phrase: z.string().max(200) }),
  z.object({ field: z.literal("noRelocation"), value: z.boolean(), phrase: z.string().max(200) }),
  // null means "remove this requirement".
  z.object({ field: z.literal("minCompBand"), value: Band.nullable(), phrase: z.string().max(200) }),
  // Any integer here: range checking happens in code so a bad value is explained, not rejected.
  z.object({
    field: z.literal("maxMonths"),
    value: z.number().int().nullable(),
    phrase: z.string().max(200),
  }),
  z.object({
    field: z.literal("riskTolerance"),
    value: z.enum(["low", "medium", "high"]),
    phrase: z.string().max(200),
  }),
  z.object({
    field: z.literal("skills"),
    action: z.enum(["add", "remove"]),
    value: z.array(z.string().max(40)).max(8),
    phrase: z.string().max(200),
  }),
]);
export type ModelChange = z.infer<typeof ModelChange>;

/** A request the cohort data cannot represent, for example "4-day work week". */
export const Unsupported = z.object({ phrase: z.string().max(200), reason: z.string().max(200) });
export type Unsupported = z.infer<typeof Unsupported>;

/** Two parts of the message that cannot both be true, and the fields they fight over. */
export const Contradiction = z.object({
  fields: z.array(ChangeField).min(1).max(4),
  phrases: z.array(z.string().max(200)).min(1).max(4),
  description: z.string().max(250),
});
export type Contradiction = z.infer<typeof Contradiction>;

/** A question to put to the user when part of the request is too vague to apply. */
export const Clarification = z.object({
  question: z.string().min(1).max(250),
  about: z.union([ChangeField, z.literal("other")]),
  /** Optional quick answers the UI can show as buttons. */
  options: z.array(z.string().max(60)).max(4).optional(),
});
export type Clarification = z.infer<typeof Clarification>;

/** Everything the model returns. */
export const ModelOutput = z.object({
  changes: z.array(ModelChange).max(8),
  unsupported: z.array(Unsupported).max(5),
  contradictions: z.array(Contradiction).max(3),
  clarification: Clarification.nullable(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

// ---------- what code returns ----------

/** A change that was validated and applied, in a form ready to show a person. */
export interface AppliedChange {
  field: ChangeField;
  /** Human-readable label, e.g. "No relocation". */
  label: string;
  /** Display value before the change, e.g. "off" or "B3". */
  from: string;
  /** Display value after the change. */
  to: string;
  /** The user's words that led to it. */
  phrase: string;
}

/** A proposed change that code refused, with a reason a person can read. */
export interface RefusedChange {
  field: ChangeField;
  phrase: string;
  reason: string;
}

/** A problem with the resulting constraints, found by code. */
export interface Conflict {
  /**
   * "contradiction": the message asked for opposite things, so neither was applied.
   * "infeasible": the evidence shows the new constraints leave no good route; applied anyway,
   * because the person decides, but flagged with numbers.
   * "thin_evidence": the constraints leave so few comparable engineers that any route is shaky.
   */
  kind: "contradiction" | "infeasible" | "thin_evidence";
  fields: ChangeField[];
  message: string;
}

/** The outcome of interpreting one What-if message. */
export interface Interpretation {
  /**
   * "applied": every part was understood and applied.
   * "needs_clarification": part of it was too vague; clear parts were applied, `clarification` asks the rest.
   * "nothing_applicable": nothing in the message could be turned into a change.
   */
  status: "applied" | "needs_clarification" | "nothing_applicable";
  /** The constraints after applying the validated changes (equal to the input when nothing applied). */
  next: Constraints;
  applied: AppliedChange[];
  refused: RefusedChange[];
  unsupported: Unsupported[];
  conflicts: Conflict[];
  clarification?: Clarification;
  /** Plain observations for the trace, such as discarded hallucinated quotes. */
  notes: string[];
}

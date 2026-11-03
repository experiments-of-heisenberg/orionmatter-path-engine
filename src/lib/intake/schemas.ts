/**
 * schemas.ts: the data shapes of the Intake agent.
 *
 *   ModelOutput   what the MODEL returns: each field with the words it was read from
 *   Draft         the profile being built, every field optional until the person confirms it
 *   IntakeResult  what the interface receives: the draft, where each field came from, what is
 *                 missing and the questions to ask, and warnings
 *
 * Honesty rule: nothing Intake produces is verified. `verified` is the literal false, and every
 * milestone keeps `verified: false` (the shared Profile schema enforces it).
 */
import { z } from "zod";
import { RoleFamily, type Goal, type Profile } from "../schemas";

/** A value the model read, with the words it read it from. */
const quoted = <T extends z.ZodType>(value: T) => z.object({ value, quote: z.string().min(1).max(200) });

/** What the model returns. Every field is nullable: "not stated" is a valid and common answer. */
export const IntakeModelOutput = z.object({
  roleFamily: quoted(RoleFamily).nullable(),
  /** A canonical level label (L3 to L7, EM1, EM2) the text states literally. */
  level: quoted(z.string().max(10)).nullable(),
  /** The employer and job title as written, so code can map them with the level table. */
  company: quoted(z.string().max(80)).nullable(),
  title: quoted(z.string().max(80)).nullable(),
  yearsExperience: quoted(z.number()).nullable(),
  region: quoted(z.string().max(20)).nullable(),
  /** A pay band label (B1 to B5), only when the text states one. */
  compBand: quoted(z.string().max(4)).nullable(),
  /** Technologies and skills named in the text, each as written. */
  stack: z.array(z.string().max(40)).max(30),
  milestones: z
    .array(
      z.object({
        type: z.string().min(1).max(40),
        quarter: z.string().max(10),
        note: z.string().min(1).max(200),
        quote: z.string().min(1).max(200),
      }),
    )
    .max(20),
  /** The target the person says they want, when stated. */
  goal: z
    .object({ targetLevel: z.string().max(10), label: z.string().max(60), quote: z.string().min(1).max(200) })
    .nullable(),
});
export type IntakeModelOutput = z.infer<typeof IntakeModelOutput>;

/** The fields a plan cannot be made without. */
export const REQUIRED_FIELDS = ["roleFamily", "level", "yearsExperience", "region"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** The profile being built. Fields are optional until the person has confirmed them. */
export interface Draft {
  roleFamily?: z.infer<typeof RoleFamily>;
  level?: string;
  yearsExperience?: number;
  region?: string;
  compBand?: string;
  stack: string[];
  milestones: Profile["milestones"];
  goal?: Goal;
}

/** Where a field's value came from. "earlier" means a previous turn of the same conversation. */
export interface Provenance {
  source: "text" | "image" | "earlier" | "mapped";
  /** The person's own words it was read from (text only; an image cannot be quoted back reliably). */
  quote?: string;
  /** For "mapped": how it was derived, e.g. "BigTech A / Senior SDE". */
  via?: string;
}

/** What the interface receives. */
export interface IntakeResult {
  /**
   * "complete": every required field is present, so `profile` exists (still unconfirmed).
   * "needs_info": something required is missing; `questions` says what to ask.
   * "nothing_found": the input contained nothing usable.
   */
  status: "complete" | "needs_info" | "nothing_found";
  draft: Draft;
  /** Where each filled field came from, keyed by field name. */
  provenance: Record<string, Provenance>;
  /** Present only when status is "complete". */
  profile?: Profile;
  goal?: Goal;
  missing: RequiredField[];
  /** One plain question per missing field, written by code. */
  questions: string[];
  /** Things the model proposed that code refused, each with a reason. */
  discarded: string[];
  /** Cautions: limits of the evidence, redaction, images. */
  warnings: string[];
  redactions: { emails: number; phones: number; links: number };
  /** Always false: nothing here has been checked against any record. */
  verified: false;
}

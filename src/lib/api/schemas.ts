/**
 * schemas.ts: what each API route accepts.
 *
 * Everything from the browser is untrusted. These Zod schemas are the only definition of a valid
 * request; they reuse the engine's own schemas (Profile, Goal, Constraints) so the API can never
 * accept something the engine would reject, and every object is `strict()` so a misspelt or extra
 * field is an error instead of being silently ignored.
 */
import { z } from "zod";
import { MAX_INTAKE_CHARS } from "../intake";
import { Constraints, Goal, Profile, RoleFamily } from "../schemas";

/** Longest data URL accepted, in characters: a 4 MB image is about 5.4 million base64 characters. */
const MAX_DATA_URL_CHARS = 5_800_000;

/** The profile being built by Intake, as the browser sends it back on a follow-up turn. */
const DraftSchema = z
  .object({
    roleFamily: RoleFamily.optional(),
    level: z.string().max(10).optional(),
    yearsExperience: z.number().min(0).max(40).optional(),
    region: z.string().max(20).optional(),
    compBand: z.string().max(4).optional(),
    stack: z.array(z.string().max(40)).max(15),
    milestones: Profile.shape.milestones,
    goal: Goal.optional(),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    source: z.enum(["text", "image", "earlier", "mapped"]),
    quote: z.string().max(200).optional(),
    via: z.string().max(120).optional(),
  })
  .strict();

export const IntakeRequest = z
  .object({
    text: z
      .string()
      .max(MAX_INTAKE_CHARS + 1000)
      .optional(),
    imageDataUrl: z.string().max(MAX_DATA_URL_CHARS).optional(),
    previous: z
      .object({ draft: DraftSchema, provenance: z.record(z.string().max(30), ProvenanceSchema) })
      .strict()
      .optional(),
  })
  .strict();
export type IntakeRequest = z.infer<typeof IntakeRequest>;

export const PlanRequest = z
  .object({ profile: Profile, goal: Goal, constraints: Constraints.default(Constraints.parse({})) })
  .strict();
export type PlanRequest = z.infer<typeof PlanRequest>;

/** The fast, model-free path used by sliders. */
export const ExploreRequest = PlanRequest;
export type ExploreRequest = z.infer<typeof ExploreRequest>;

export const WhatIfRequest = z
  .object({
    message: z.string().max(2000),
    current: Constraints.default(Constraints.parse({})),
    profile: Profile,
    goal: Goal,
    history: z
      .array(z.object({ question: z.string().max(400), answer: z.string().max(600) }).strict())
      .max(3)
      .optional(),
    /** Ask the model to phrase the explanation. Default true; false returns the code-written template. */
    narrate: z.boolean().optional(),
  })
  .strict();
export type WhatIfRequest = z.infer<typeof WhatIfRequest>;

export const PrivacyRequest = z
  .object({
    profile: Profile,
    goal: Goal,
    text: z.string().max(3500).optional(),
    companyType: z.string().max(40).optional(),
    k: z.number().int().min(1).max(1000).optional(),
    useModel: z.boolean().optional(),
  })
  .strict();
export type PrivacyRequest = z.infer<typeof PrivacyRequest>;

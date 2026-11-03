/**
 * schemas.ts: Zod contracts for every domain object.
 *
 * Model output, tool arguments, and plan shapes are all untrusted until parsed
 * here, so agents and tools share one validated vocabulary.
 */
import { z } from "zod";

// Job-family enum shared by Profile and CohortRecord.
export const RoleFamily = z.enum(["backend", "platform", "ml", "frontend", "embedded", "sre"]);
// Plan shape (climb/jump/pivot); selects which twins pathStats aggregates and labels each Route.
export const Archetype = z.enum(["climb", "jump", "pivot"]);
/** The three route archetypes the Planner produces. */
export type Archetype = z.infer<typeof Archetype>;
// How a cohort career ended; pathStats counts "reached" for rates and names risks from the rest.
export const Outcome = z.enum(["reached", "stalled", "left-field"]);

// One synthetic career history; the row type of COHORT in tools/data.ts.
export const CohortRecord = z.object({
  id: z.string(),
  synthetic: z.literal(true),
  roleFamily: RoleFamily,
  startLevel: z.enum(["L3", "L4", "L5"]),
  endLevel: z.enum(["L4", "L5", "L6", "L7", "EM1", "EM2"]),
  archetype: Archetype,
  companyTypeSteps: z.array(z.string()),
  months: z.number(),
  compBandStart: z.string(),
  compBandEnd: z.string(),
  remote: z.boolean(),
  skillsProven: z.array(z.string()),
  outcome: Outcome,
  region: z.string(),
});
/** Inferred `CohortRecord` row type; the element type of COHORT and kAnonymity's cohort. */
export type CohortRecord = z.infer<typeof CohortRecord>;

// The user's verified-ish current position; findTwins matches twins against it.
export const Profile = z.object({
  roleFamily: RoleFamily,
  level: z.string(),
  yearsExperience: z.number().min(0).max(40),
  stack: z.array(z.string()).max(15),
  region: z.string(),
  compBand: z.string().optional(),
  milestones: z
    .array(
      z.object({
        type: z.string(),
        quarter: z.string(),
        note: z.string().max(200),
        verified: z.literal(false),
      }),
    )
    .max(20)
    .default([]),
});
/** Inferred `Profile` type; milestones stay unverified (`verified: false`) by construction. */
export type Profile = z.infer<typeof Profile>;

// What-if knobs (remote, relocation, risk); findTwins reads remote/noRelocation.
export const Constraints = z.object({
  remote: z.boolean().optional(),
  noRelocation: z.boolean().optional(),
  minCompBand: z.string().optional(),
  maxMonths: z.number().optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).default("medium"),
  addSkills: z.array(z.string()).default([]),
});
/** Inferred `Constraints` type; riskTolerance defaults to "medium", addSkills to []. */
export type Constraints = z.infer<typeof Constraints>;

// Target level plus a human-readable label; findTwins requires twins to have reached it.
export const Goal = z.object({ targetLevel: z.string(), label: z.string() });
/** Inferred `Goal` type; targetLevel is a free string so unknown ladders still parse. */
export type Goal = z.infer<typeof Goal>;

// One evidence-backed statement citing ledger ids; steps use it in whyItWorks.
export const Claim = z.object({
  text: z.string().max(240),
  evidenceIds: z.array(z.string()).min(1),
  n: z.number().int().nonnegative(),
  range: z.tuple([z.number(), z.number()]).optional(),
});
/** Inferred `Claim` type; every claim needs at least one evidence id and a sample size. */
export type Claim = z.infer<typeof Claim>;

// One dated plan step (what, window, proof); a Route holds 2-6 of them.
export const Step = z.object({
  what: z.string(),
  monthWindow: z.tuple([z.number(), z.number()]),
  whyItWorks: z.array(Claim),
  proofNeeded: z.array(z.string()),
  gapClosers: z.array(z.string()),
  companyMarkerIds: z.array(z.string()),
});

// One proposed path: archetype, steps, metric ranges, and the evidence-thin flag.
export const Route = z.object({
  archetype: Archetype,
  summary: z.string().max(400),
  steps: z.array(Step).min(2).max(6),
  metrics: z.object({
    monthsToGoal: z.tuple([z.number(), z.number()]),
    compGrowthBand: z.tuple([z.string(), z.string()]),
    reachedRate: z.tuple([z.number(), z.number()]),
    evidenceN: z.number().int(),
    radar: z.object({
      comp: z.number(),
      speed: z.number(),
      risk: z.number(),
      learning: z.number(),
      balance: z.number(),
      stability: z.number(),
    }),
  }),
  evidenceThin: z.boolean(),
});
/** Inferred `Route` type; metrics are ranges plus a sample size, never point estimates. */
export type Route = z.infer<typeof Route>;
/** One move on a route (what, when, why it works with evidence, proof needed, gap closers). */
export type Step = z.infer<typeof Step>;

// The planner's output contract (consumed by later agent parts): exactly three routes plus caveats.
export const PlanResult = z.object({
  routes: z.array(Route).length(3),
  caveats: z.array(z.string()).min(1),
});
/** Inferred `PlanResult` type; always three routes and at least one caveat. */
export type PlanResult = z.infer<typeof PlanResult>;

// The skeptic reviewer's verdict contract (used by later agent parts): approval plus rejections.
export const SkepticVerdict = z.object({
  approved: z.boolean(),
  rejections: z.array(
    z.object({
      routeIndex: z.number(),
      claimText: z.string(),
      reason: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});
/** Inferred `SkepticVerdict` type; rejections point at a route index and a claim. */
export type SkepticVerdict = z.infer<typeof SkepticVerdict>;

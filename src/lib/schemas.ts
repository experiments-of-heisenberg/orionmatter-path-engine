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
  level: z.string().max(10),
  yearsExperience: z.number().min(0).max(40),
  stack: z.array(z.string().max(40)).max(15),
  region: z.string().max(20),
  compBand: z.string().max(4).optional(),
  milestones: z
    .array(
      z.object({
        type: z.string().max(40),
        quarter: z.string().max(10),
        note: z.string().max(200),
        verified: z.literal(false),
      }),
    )
    .max(20)
    .default([]),
});
/** Inferred `Profile` type; milestones stay unverified (`verified: false`) by construction. */
export type Profile = z.infer<typeof Profile>;

import { MAX_SKILLS } from "./limits";
/** Most skills a person can ask about at once. The What-if interpreter enforces the same limit. */
export { MAX_SKILLS };

// What-if knobs (remote, relocation, risk); findTwins reads remote/noRelocation.
export const Constraints = z.object({
  remote: z.boolean().optional(),
  noRelocation: z.boolean().optional(),
  /** A pay band B1 (lowest) to B5 (highest). */
  minCompBand: z
    .string()
    .regex(/^B[1-5]$/, "minCompBand must be B1 to B5")
    .optional(),
  /** A time limit in whole months, 1 to 240. */
  maxMonths: z.number().int().min(1).max(240).optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).default("medium"),
  /** Skills the person asks about. At most MAX_SKILLS, each a short name: every one costs a tool call per route. */
  addSkills: z.array(z.string().min(1).max(40)).max(MAX_SKILLS).default([]),
});
/** Inferred `Constraints` type; riskTolerance defaults to "medium", addSkills to []. */
export type Constraints = z.infer<typeof Constraints>;

// Target level plus a human-readable label; findTwins requires twins to have reached it.
export const Goal = z.object({ targetLevel: z.string().max(10), label: z.string().max(60) });
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
  // Ledger evidence ids behind this route's metrics (its pathStats call and the compBands call).
  evidenceIds: z.array(z.string()).min(1),
  metrics: z.object({
    // P25 to P75 months among twins who reached the goal; null when none did (no timing evidence).
    monthsToGoal: z.tuple([z.number(), z.number()]).nullable(),
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
/** The six radar axes, each 0 to 100 where higher is more favourable. See engine/radar.ts for how each is derived. */
export type Radar = Route["metrics"]["radar"];

// The planner's output contract (consumed by later agent parts): exactly three routes plus caveats.
export const PlanResult = z.object({
  routes: z.array(Route).length(3),
  caveats: z.array(z.string()).min(1),
});
/** Inferred `PlanResult` type; always three routes and at least one caveat. */
export type PlanResult = z.infer<typeof PlanResult>;

// The skeptic reviewer's verdict contract (used by later agent parts): approval plus rejections.
/** Which layer of the Skeptic raised a rejection. */
export const RejectionSource = z.enum(["verifier", "critic"]);

/** One thing the Skeptic wants fixed. */
export const Rejection = z.object({
  /** Machine-readable problem code, e.g. "n_mismatch". The UI groups and colours by it. */
  code: z.string(),
  source: RejectionSource,
  /** Index into plan.routes, or -1 for a problem with the plan as a whole. */
  routeIndex: z.number().int(),
  /** Index into the route's steps when the problem is inside one step. */
  stepIndex: z.number().int().optional(),
  /** The offending text, quoted so a person can find it ("(summary)" when it is the route summary). */
  claimText: z.string(),
  /** Plain-language explanation, written so the Planner can act on it. */
  reason: z.string(),
});
/** Inferred `Rejection` type. */
export type Rejection = z.infer<typeof Rejection>;

/** The Skeptic's verdict on a plan. Approved means no rejections remain. */
export const SkepticVerdict = z.object({
  approved: z.boolean(),
  rejections: z.array(Rejection),
  notes: z.array(z.string()),
});
export type SkepticVerdict = z.infer<typeof SkepticVerdict>;

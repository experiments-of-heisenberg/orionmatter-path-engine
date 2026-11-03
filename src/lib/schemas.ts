import { z } from "zod";

export const RoleFamily = z.enum(["backend", "platform", "ml", "frontend", "embedded", "sre"]);
export const Archetype = z.enum(["climb", "jump", "pivot"]);
export const Outcome = z.enum(["reached", "stalled", "left-field"]);

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
export type CohortRecord = z.infer<typeof CohortRecord>;

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
export type Profile = z.infer<typeof Profile>;

export const Constraints = z.object({
  remote: z.boolean().optional(),
  noRelocation: z.boolean().optional(),
  minCompBand: z.string().optional(),
  maxMonths: z.number().optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).default("medium"),
  addSkills: z.array(z.string()).default([]),
});
export type Constraints = z.infer<typeof Constraints>;

export const Goal = z.object({ targetLevel: z.string(), label: z.string() });
export type Goal = z.infer<typeof Goal>;

export const Claim = z.object({
  text: z.string().max(240),
  evidenceIds: z.array(z.string()).min(1),
  n: z.number().int().nonnegative(),
  range: z.tuple([z.number(), z.number()]).optional(),
});
export type Claim = z.infer<typeof Claim>;

export const Step = z.object({
  what: z.string(),
  monthWindow: z.tuple([z.number(), z.number()]),
  whyItWorks: z.array(Claim),
  proofNeeded: z.array(z.string()),
  gapClosers: z.array(z.string()),
  companyMarkerIds: z.array(z.string()),
});

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
export type Route = z.infer<typeof Route>;

export const PlanResult = z.object({
  routes: z.array(Route).length(3),
  caveats: z.array(z.string()).min(1),
});
export type PlanResult = z.infer<typeof PlanResult>;

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
export type SkepticVerdict = z.infer<typeof SkepticVerdict>;

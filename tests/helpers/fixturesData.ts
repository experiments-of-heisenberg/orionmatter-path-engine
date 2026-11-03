/**
 * Shared builders for engine and planner tests: a standard person and goal, and a function
 * that writes a valid model draft from the fact sheet found in a compose prompt.
 */
import type { FactSheet } from "../../src/lib/engine";
import { Constraints, Goal, Profile } from "../../src/lib/schemas";
import type { EngineInput } from "../../src/lib/engine";
import type { ChatRequest } from "../../src/lib/model";

export const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go", "kubernetes"],
  region: "IN-south",
});
export const goal = Goal.parse({ targetLevel: "L6", label: "Staff Engineer" });
export const constraints = Constraints.parse({});
export const input: EngineInput = { profile, goal, constraints };

/** A thin-evidence input: the ML pivot cohort is deliberately under 15 people. */
export const mlInput: EngineInput = { ...input, profile: Profile.parse({ ...profile, roleFamily: "ml" }) };

type PromptFacts = {
  routes: Array<{
    archetype: string;
    statsEvidenceId: string;
    n: number;
    reachedRate: [number, number];
    monthsToGoal: [number, number] | null;
  }>;
};

/** Pull the fact sheet JSON out of a compose request's user message. */
export function factsFromRequest(request: ChatRequest): PromptFacts {
  const user = request.messages.find((m) => m.role === "user");
  const text = typeof user?.content === "string" ? user.content : "";
  const match = /<fact_sheet>\n([\s\S]*?)\n<\/fact_sheet>/.exec(text);
  if (!match?.[1]) throw new Error("no fact sheet in compose prompt");
  return JSON.parse(match[1]) as PromptFacts;
}

/** A valid draft JSON string whose claims cite the evidence in the prompt's fact sheet. */
export function draftFromRequest(request: ChatRequest, extra: Record<string, unknown> = {}): string {
  const facts = factsFromRequest(request);
  const routes = facts.routes.map((route) => ({
    archetype: route.archetype,
    summary: `The ${route.archetype} route, based on ${route.n} comparable engineers.`,
    steps: [
      {
        what: `First move on the ${route.archetype} route`,
        monthWindow: [0, route.monthsToGoal ? Math.floor(route.monthsToGoal[1] / 2) : 0],
        whyItWorks: [
          {
            text: `Twins on this route typically took a range of months to reach the goal (n=${route.n}).`,
            evidenceIds: [route.statsEvidenceId],
            n: route.n,
            ...(route.monthsToGoal ? { range: route.monthsToGoal } : {}),
          },
        ],
        proofNeeded: ["a shipped system"],
        gapClosers: ["lead a design review"],
        companyMarkerIds: [],
      },
      {
        what: `Second move on the ${route.archetype} route`,
        monthWindow: [
          route.monthsToGoal ? Math.floor(route.monthsToGoal[1] / 2) : 0,
          route.monthsToGoal?.[1] ?? 0,
        ],
        whyItWorks: [
          {
            text: `Of comparable engineers, a range reached the goal (n=${route.n}).`,
            evidenceIds: [route.statsEvidenceId],
            n: route.n,
            range: route.reachedRate,
          },
        ],
        proofNeeded: ["a public design doc"],
        gapClosers: ["find a mentor"],
        companyMarkerIds: [],
      },
    ],
    ...extra,
  }));
  return JSON.stringify({ routes, caveats: [] });
}

export type { FactSheet };

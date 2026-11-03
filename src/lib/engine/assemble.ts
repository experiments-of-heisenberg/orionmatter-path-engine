/**
 * assemble.ts: merge model-written drafts with code-computed facts into a final plan.
 *
 * This is where "LLMs narrate, tools compute" becomes structural. The final `Route`
 * takes its words from the draft and EVERY number from the fact sheet. There is no
 * code path by which a figure the model wrote can reach `metrics`.
 */
import type { PlanResult, Route } from "../schemas";
import type { PlanDraft, RouteDraft } from "./drafts";
import { ARCHETYPES, type FactSheet, type RouteFacts } from "./facts";

/**
 * Build one final route.
 *
 * @param draft the model's summary and steps for this archetype
 * @param facts the code-computed facts for the same archetype
 */
export function assembleRoute(draft: RouteDraft, facts: RouteFacts): Route {
  return {
    archetype: draft.archetype,
    summary: draft.summary,
    steps: draft.steps,
    evidenceIds: [facts.statsEvidenceId, facts.compEvidenceId],
    metrics: {
      monthsToGoal: facts.monthsToGoal,
      compGrowthBand: facts.compBandRange,
      reachedRate: facts.reachedRate,
      evidenceN: facts.n,
      radar: facts.radar,
    },
    evidenceThin: facts.evidenceThin,
  };
}

/**
 * The survivorship-bias caveat, generated from data so it is always present and accurate.
 * The model is not trusted to remember it.
 */
export function survivorshipCaveat(sheet: FactSheet): string {
  const { totalTwins, notReachedShare } = sheet.survivorship;
  if (totalTwins === 0) {
    return "No comparable engineers were found in the synthetic cohort, so none of these routes has outcome evidence.";
  }
  const percent = Math.round(notReachedShare * 100);
  return (
    `Of ${totalTwins} comparable engineers across these routes, about ${percent}% did not reach the goal ` +
    "(they stalled or left the field). People who struggle on a path are less likely to share it, " +
    "so real-world success rates may be lower than any cohort suggests."
  );
}

/**
 * Assemble the final plan, with routes always in the order climb, jump, pivot.
 *
 * @throws Error if a draft is missing for an archetype. PlanDraft validation normally
 *         prevents this, so reaching it means a programming error.
 */
export function assemblePlan(draft: PlanDraft, sheet: FactSheet): PlanResult {
  const routes = ARCHETYPES.map((archetype) => {
    const routeDraft = draft.routes.find((route) => route.archetype === archetype);
    const facts = sheet.routes.find((route) => route.archetype === archetype);
    if (!routeDraft || !facts) throw new Error(`cannot assemble: missing draft or facts for "${archetype}"`);
    return assembleRoute(routeDraft, facts);
  });
  return { routes, caveats: [survivorshipCaveat(sheet), ...draft.caveats] };
}

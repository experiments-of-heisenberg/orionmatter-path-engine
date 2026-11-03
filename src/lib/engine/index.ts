/**
 * Public entry point of the deterministic route engine.
 *
 * Everything here is pure code over the synthetic cohort: no model, no network.
 */
export { assemblePlan, assembleRoute, survivorshipCaveat } from "./assemble";
export { PlanDraft, RouteDraft } from "./drafts";
export { ARCHETYPES, gatherEvidence, limitsOf } from "./facts";
export type { EngineInput, FactSheet, RouteFacts, SkillFacts } from "./facts";
export { rankRoutes } from "./rank";
export type { Ranking } from "./rank";
export { computeRadar, RADAR_BASIS } from "./radar";
export { summarizeEvidence } from "./summaries";

/**
 * Public entry point of the deterministic route engine.
 *
 * Everything here is pure code over the synthetic cohort: no model, no network.
 */
export { assemblePlan, assembleRoute, survivorshipCaveat } from "./assemble";
export { PlanDraft, RouteDraft } from "./drafts";
export { ARCHETYPES, gatherEvidence } from "./facts";
export type { EngineInput, FactSheet, RouteFacts } from "./facts";
export { computeRadar, RADAR_BASIS } from "./radar";
export { summarizeEvidence } from "./summaries";

/**
 * serialize.ts: shape engine results for the browser.
 *
 * Two rules. First, the browser gets what it needs to draw and explain, not internals: no twin id
 * lists (150 ids per plan), no raw ledger. Second, every number the browser shows still traces to
 * an evidence id, so those ids stay.
 */
import { summarizeEvidence, type FactSheet, type RouteFacts, type Ranking } from "../engine";
import type { RunPlanOutput } from "../orchestrator";
import type { Constraints, Goal } from "../schemas";
import type { EvidenceLedger } from "../tools/ledger";
import type { SkillFacts } from "../engine";

/** One route's facts, as sent to the browser. */
export interface ClientRoute {
  archetype: RouteFacts["archetype"];
  statsEvidenceId: string;
  compEvidenceId: string;
  /** Comparable engineers on this route. */
  n: number;
  /** Of those, how many reached the goal within the person's limits. */
  reachedN: number;
  evidenceThin: boolean;
  monthsToGoal: RouteFacts["monthsToGoal"];
  reachedRate: RouteFacts["reachedRate"];
  compBandRange: RouteFacts["compBandRange"];
  topRisks: string[];
  topGates: string[];
  topCompanyTypes: string[];
  radar: RouteFacts["radar"];
  /** Share of the route's comparable engineers by outcome, including those who reached it outside the limits. */
  outcomeShares: RouteFacts["stats"]["outcomeShares"];
  /** What the cohort says when the person's limits are ignored. */
  ignoringLimits: RouteFacts["stats"]["ignoringLimits"];
  skills: SkillFacts[];
}

/** A fact sheet, as sent to the browser. */
export interface ClientSheet {
  goal: Goal;
  constraints: Constraints;
  twins: FactSheet["twins"];
  routes: ClientRoute[];
  ranking: Ranking;
  survivorship: FactSheet["survivorship"];
}

/** Trim a fact sheet to what the browser needs. */
export function sheetToClient(sheet: FactSheet): ClientSheet {
  return {
    goal: sheet.input.goal,
    constraints: sheet.input.constraints,
    twins: sheet.twins,
    routes: sheet.routes.map((route) => ({
      archetype: route.archetype,
      statsEvidenceId: route.statsEvidenceId,
      compEvidenceId: route.compEvidenceId,
      n: route.n,
      reachedN: route.stats.reachedN,
      evidenceThin: route.evidenceThin,
      monthsToGoal: route.monthsToGoal,
      reachedRate: route.reachedRate,
      compBandRange: route.compBandRange,
      topRisks: route.topRisks,
      topGates: route.topGates,
      topCompanyTypes: route.topCompanyTypes,
      radar: route.radar,
      outcomeShares: route.stats.outcomeShares,
      ignoringLimits: route.stats.ignoringLimits,
      skills: route.skills,
    })),
    ranking: sheet.ranking,
    survivorship: sheet.survivorship,
  };
}

/** One recorded tool call, summarised for the Agent Trace. */
export interface ClientEvidence {
  evidenceId: string;
  tool: string;
  summary: string;
}

/** Every tool call in a ledger as one line each (never the twin id lists). */
export function evidenceToClient(ledger: EvidenceLedger): ClientEvidence[] {
  return ledger.all().map((e) => ({ evidenceId: e.evidenceId, tool: e.tool, summary: summarizeEvidence(e) }));
}

/** The result of a full plan run, as sent to the browser. */
export interface ClientPlanRun {
  status: RunPlanOutput["status"];
  revisions: number;
  plan: RunPlanOutput["plan"];
  verdicts: RunPlanOutput["verdicts"];
  sheet: ClientSheet;
  evidence: ClientEvidence[];
  /** Tools code ran because the model skipped them. */
  filledIn: string[];
  /** True when the plan's composition needed its one repair attempt. */
  repaired: boolean;
}

export function planToClient(out: RunPlanOutput): ClientPlanRun {
  return {
    status: out.status,
    revisions: out.revisions,
    plan: out.plan,
    verdicts: out.verdicts,
    sheet: sheetToClient(out.sheet),
    evidence: evidenceToClient(out.ledger),
    filledIn: out.planner.filledIn,
    repaired: out.planner.repaired,
  };
}

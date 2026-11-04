/**
 * plan.ts: the state of a plan run, as plain data.
 *
 * A plan run takes about 25 seconds: the Planner gathers evidence and writes three routes, the Skeptic checks
 * every claim, and the Planner revises if it must. While it runs the screen shows the Agent Trace; when it ends
 * the screen shows the plan and the Skeptic's verdict, whatever that verdict is. A plan belongs to the limits it
 * was made for: when the person changes them, the plan is marked as made for earlier limits and its steps leave
 * the map, because the numbers around them have moved. All of that is decided here, as pure functions.
 */
import type { AgentEvent } from "../lib/agents";
import type { ClientPlanRun } from "../lib/api/serialize";
import type { Constraints, Route } from "../lib/schemas";
import { EMPTY_TRACE, reduceTrace, type Trace } from "./trace";
import { sameConstraints } from "./limits";
import { type Archetype } from "./format";

export type PlanPhase = "idle" | "running" | "done" | "error";

export interface PlanState {
  phase: PlanPhase;
  trace: Trace;
  result?: ClientPlanRun;
  error?: string;
  /** The limits this plan was asked for. */
  forConstraints?: Constraints;
}

export const IDLE_PLAN: PlanState = { phase: "idle", trace: EMPTY_TRACE };

/** Begin a run for these limits. Any earlier plan is dropped. */
export function planStarted(constraints: Constraints): PlanState {
  return { phase: "running", trace: EMPTY_TRACE, forConstraints: constraints };
}

/** Fold a streamed event into a running plan. Events that arrive after the run ended are ignored. */
export function planProgress(state: PlanState, event: AgentEvent): PlanState {
  if (state.phase !== "running") return state;
  return { ...state, trace: reduceTrace(state.trace, event) };
}

/** The run finished with a plan. */
export function planFinished(state: PlanState, result: ClientPlanRun): PlanState {
  return { ...state, phase: "done", result };
}

/** The run failed. The trace so far stays, so the person can see how far it got. */
export function planFailed(state: PlanState, error: string): PlanState {
  const { result: _result, ...rest } = state;
  return { ...rest, phase: "error", error };
}

/** True when the plan was made for limits that are not the current ones. */
export function planIsStale(state: PlanState, current: Constraints): boolean {
  return (
    state.phase === "done" &&
    state.forConstraints !== undefined &&
    !sameConstraints(state.forConstraints, current)
  );
}

/** How many objections the Skeptic still has in its last check. */
export function remainingObjections(result: ClientPlanRun): number {
  return result.verdicts.at(-1)?.rejections.length ?? 0;
}

/** One sentence on what the Skeptic concluded, always including when it did not approve. */
export function planHeadline(result: ClientPlanRun): string {
  const revisions = result.revisions;
  if (result.status === "approved") {
    return revisions === 0
      ? "The Skeptic approved this plan on its first check."
      : `The Skeptic approved this plan after ${revisions} revision${revisions === 1 ? "" : "s"}.`;
  }
  const left = remainingObjections(result);
  return `The Skeptic did not approve this plan: ${left} objection${left === 1 ? "" : "s"} remain${left === 1 ? "s" : ""} after ${revisions} revision${revisions === 1 ? "" : "s"}. Read the objections before relying on it.`;
}

/** "Right away" or "Months 6 to 12". */
export function windowText(window: readonly [number, number]): string {
  const [a, b] = window;
  if (a === 0 && b === 0) return "Right away";
  if (a === b) return `Month ${a}`;
  return `Months ${a} to ${b}`;
}

/** A route of the plan by archetype. */
export function routeOf(result: ClientPlanRun, archetype: Archetype): Route | undefined {
  return result.plan.routes.find((r) => r.archetype === archetype);
}

/**
 * The steps to draw on the map, or undefined. Only an approved plan whose limits are still the current ones puts
 * its steps on the map: an unresolved plan has claims the Skeptic did not clear, and a stale one sits among numbers that moved.
 *
 * `shown` is the limits the map's own numbers were computed for. The plan can come back before the map has redrawn
 * for new limits (the map refreshes on a short delay and keeps the old numbers until the new ones arrive), and steps
 * drawn along a route of the old numbers would jump or vanish a moment later. Leave it out when there is no map to compare with.
 */
export function stepsForMap(
  state: PlanState,
  current: Constraints,
  archetype: Archetype,
  shown?: Constraints,
): { archetype: Archetype; steps: Route["steps"] } | undefined {
  if (state.phase !== "done" || !state.result || state.result.status !== "approved") return undefined;
  if (planIsStale(state, current)) return undefined;
  if (shown !== undefined && !sameConstraints(shown, current)) return undefined;
  const route = routeOf(state.result, archetype);
  return route ? { archetype, steps: route.steps } : undefined;
}

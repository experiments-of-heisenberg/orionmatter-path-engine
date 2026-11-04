/**
 * trace.ts: the Agent Trace as plain data.
 *
 * A plan run streams events while the Planner (Muse Spark) gathers evidence, writes the plan, and the Skeptic
 * checks it. The Agent Trace panel shows that story in order: which stage is running, every tool the Planner
 * called and what came back, which tools code had to fill in, and every objection the Skeptic raised and how it
 * was resolved. This module turns the raw events into that list, one pure step at a time, so the panel is only
 * painting and the whole thing is tested without a browser. Nothing is staged or invented: an item exists only
 * because an event said so.
 */
import type { AgentEvent } from "../lib/agents";
import type { Rejection } from "../lib/schemas";

/** Most items kept, so a runaway stream cannot grow the page without bound. */
export const MAX_TRACE_ITEMS = 200;

export type CallStatus = "running" | "ok" | "error";

export type TraceItem =
  | {
      kind: "stage";
      stage: Extract<AgentEvent, { type: "stage" }>["stage"];
      round: number | undefined;
      label: string;
    }
  | {
      kind: "call";
      id: string;
      name: string;
      /** What was asked, in words. */
      label: string;
      /** "agent": Muse Spark chose to call it. "engine": code filled it in because the model skipped it. */
      by: "agent" | "engine";
      status: CallStatus;
      /** What came back, in code's own words. */
      summary?: string;
      /** The ledger id a claim can cite. */
      evidenceId?: string;
    }
  | { kind: "note"; message: string }
  | { kind: "verdict"; round: number; approved: boolean; rejections: Rejection[]; notes: string[] };

export interface Trace {
  items: TraceItem[];
  /** True once the `done` stage has arrived. */
  finished: boolean;
  /** True when items were dropped because the cap was reached. */
  truncated: boolean;
}

export const EMPTY_TRACE: Trace = { items: [], finished: false, truncated: false };

/** What each stage is called on screen. */
export const STAGE_LABEL: Readonly<Record<Extract<AgentEvent, { type: "stage" }>["stage"], string>> = {
  reading: "Reading your story",
  protecting: "Protecting your privacy",
  interpreting: "Understanding your request",
  explaining: "Writing the explanation",
  gathering: "Planner: gathering evidence from the cohort",
  composing: "Planner: writing the three routes",
  auditing: "Skeptic: checking every claim",
  revising: "Planner: revising after the Skeptic's objections",
  done: "Finished",
};

/** What each Skeptic finding code means, in plain words. */
export const REJECTION_TITLE: Readonly<Record<string, string>> = {
  unknown_evidence: "Cited evidence that does not exist",
  wrong_route_evidence: "Cited another route's evidence",
  n_mismatch: "Sample size does not match the evidence",
  range_unsupported: "A range that no evidence supports",
  ungrounded_number: "A number that is in no cited evidence",
  overclaiming_language: "Promised or guaranteed an outcome",
  window_out_of_range: "A step's months fall outside the route",
  window_order: "Steps out of order in time",
  missing_limited_evidence: "Thin evidence not stated as limited",
  unknown_marker: "Mentioned a company marker that does not exist",
  step_without_claim: "A step with no evidence behind it",
  metrics_mismatch: "Route numbers disagree with the evidence",
  missing_caveat: "The survivorship caveat is missing",
  critic: "Raised by the model-based reviewer",
};

/** Words for one tool call. Arguments are summarised, never dumped. */
export function describeCall(name: string, args: unknown): string {
  const a = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  switch (name) {
    case "findTwins":
      return "Find comparable engineers in the cohort";
    case "pathStats": {
      const route = typeof a["archetype"] === "string" ? a["archetype"] : undefined;
      return route ? `Count outcomes on the ${route} route` : "Count outcomes on a route";
    }
    case "compBands":
      return "Look up pay bands";
    case "skillStats":
      return "Compare engineers with and without a skill";
    default:
      return `Call ${name.slice(0, 40)}`;
  }
}

function push(trace: Trace, item: TraceItem): Trace {
  if (trace.items.length >= MAX_TRACE_ITEMS) return { ...trace, truncated: true };
  return { ...trace, items: [...trace.items, item] };
}

/** Fold one event into the trace. Unknown or malformed events are ignored, never thrown on. */
export function reduceTrace(trace: Trace, event: AgentEvent): Trace {
  switch (event.type) {
    case "stage": {
      const next = push(trace, {
        kind: "stage",
        stage: event.stage,
        round: event.round,
        label: STAGE_LABEL[event.stage] ?? event.stage,
      });
      return event.stage === "done" ? { ...next, finished: true } : next;
    }
    case "tool_call":
      return push(trace, {
        kind: "call",
        id: event.id,
        name: event.name,
        label: describeCall(event.name, event.args),
        by: event.by,
        status: "running",
      });
    case "tool_result": {
      const index = trace.items.findIndex((i) => i.kind === "call" && i.id === event.id);
      const status: CallStatus = event.isError ? "error" : "ok";
      if (index === -1) {
        // The engine fills a tool in without announcing the call first: show it as one finished item.
        return push(trace, {
          kind: "call",
          id: event.id,
          name: event.name,
          label: describeCall(event.name, undefined),
          by: event.by,
          status,
          summary: event.summary,
          ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}),
        });
      }
      const items = trace.items.map((item, i) =>
        i === index && item.kind === "call"
          ? {
              ...item,
              status,
              summary: event.summary,
              ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}),
            }
          : item,
      );
      return { ...trace, items };
    }
    case "note":
      return push(trace, { kind: "note", message: event.message });
    case "verdict":
      return push(trace, {
        kind: "verdict",
        round: event.round,
        approved: event.approved,
        rejections: event.rejections,
        notes: event.notes,
      });
    default:
      return trace;
  }
}

/** Fold a list of events, for tests and for replaying a recorded run. */
export function traceOf(events: readonly AgentEvent[]): Trace {
  return events.reduce(reduceTrace, EMPTY_TRACE);
}

/** What the run is doing right now, for a status line. Undefined before anything has happened. */
export function currentStage(trace: Trace): string | undefined {
  for (let i = trace.items.length - 1; i >= 0; i--) {
    const item = trace.items[i];
    if (item?.kind === "stage") return item.label;
  }
  return undefined;
}

/** One sentence about who did what: calls by the model, calls code filled in, rounds of review. */
export function traceSummary(trace: Trace): string {
  const calls = trace.items.filter((i): i is Extract<TraceItem, { kind: "call" }> => i.kind === "call");
  const byModel = calls.filter((c) => c.by === "agent").length;
  const byCode = calls.length - byModel;
  const verdicts = trace.items.filter(
    (i): i is Extract<TraceItem, { kind: "verdict" }> => i.kind === "verdict",
  );
  const revisions = Math.max(0, verdicts.length - 1);
  const parts = [
    `${calls.length} evidence lookup${calls.length === 1 ? "" : "s"}`,
    byCode > 0 ? `${byCode} filled in by code` : "all chosen by the Planner",
    `${verdicts.length} Skeptic check${verdicts.length === 1 ? "" : "s"}`,
    `${revisions} revision${revisions === 1 ? "" : "s"}`,
  ];
  return parts.join(", ");
}

/** Group a verdict's rejections by what kind of problem they are, in a stable order. */
export function groupRejections(
  rejections: readonly Rejection[],
): { code: string; title: string; items: Rejection[] }[] {
  const groups = new Map<string, Rejection[]>();
  for (const r of rejections) {
    const code = r.source === "critic" ? "critic" : r.code;
    groups.set(code, [...(groups.get(code) ?? []), r]);
  }
  return [...groups.entries()].map(([code, items]) => ({
    code,
    title: REJECTION_TITLE[code] ?? code.replace(/_/g, " "),
    items,
  }));
}

/** The headline of a verdict: "First check: approved", "First check: 2 problems", "Revision 1: approved". */
export function verdictHeadline(v: {
  round: number;
  approved: boolean;
  rejections: readonly Rejection[];
}): string {
  const who = v.round === 0 ? "First check" : `Check after revision ${v.round}`;
  if (v.approved) return `${who}: approved, no objections remain`;
  const n = v.rejections.length;
  return `${who}: ${n} objection${n === 1 ? "" : "s"}`;
}

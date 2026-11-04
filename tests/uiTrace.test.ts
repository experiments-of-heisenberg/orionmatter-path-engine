/** The Agent Trace model: events in, an honest ordered list out. */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/lib/agents";
import type { Rejection } from "../src/lib/schemas";
import {
  EMPTY_TRACE,
  MAX_TRACE_ITEMS,
  STAGE_LABEL,
  currentStage,
  describeCall,
  groupRejections,
  reduceTrace,
  traceOf,
  traceSummary,
  verdictHeadline,
} from "../src/ui/trace";
import { approvedPlan } from "./helpers/plan";

const rejection = (over: Partial<Rejection> = {}): Rejection => ({
  code: "n_mismatch",
  source: "verifier",
  routeIndex: 0,
  claimText: "Twins took 20 months (n=99)",
  reason: "n does not match the evidence",
  ...over,
});

describe("a real plan run", () => {
  it("becomes stages, code-filled evidence lookups with ids, and one approving verdict, in order", async () => {
    const { events } = await approvedPlan();
    const trace = traceOf(events);
    expect(trace.finished).toBe(true);
    expect(trace.truncated).toBe(false);
    expect(trace.items.map((i) => i.kind)).toEqual([
      "stage",
      "note",
      "call",
      "call",
      "call",
      "call",
      "call",
      "stage",
      "stage",
      "verdict",
      "stage",
    ]);
    const calls = trace.items.filter((i) => i.kind === "call");
    expect(calls.map((c) => c.kind === "call" && c.name)).toEqual([
      "findTwins",
      "compBands",
      "pathStats",
      "pathStats",
      "pathStats",
    ]);
    for (const call of calls) {
      if (call.kind !== "call") continue;
      expect(call.by).toBe("engine");
      expect(call.status).toBe("ok");
      expect(call.evidenceId).toMatch(/\w+/);
      expect(call.summary?.length).toBeGreaterThan(3);
    }
    const verdict = trace.items.find((i) => i.kind === "verdict");
    expect(verdict).toMatchObject({ approved: true, round: 0, rejections: [] });
  });

  it("is summarised in one honest sentence: who chose the lookups, how many checks and revisions", async () => {
    const trace = traceOf((await approvedPlan()).events);
    expect(traceSummary(trace)).toBe("5 evidence lookups, 5 filled in by code, 1 Skeptic check, 0 revisions");
  });

  it("the last stage reached is the 'done' stage and the label says Finished", async () => {
    const trace = traceOf((await approvedPlan()).events);
    expect(currentStage(trace)).toBe("Finished");
  });
});

describe("reduceTrace", () => {
  it("a call is 'running' until its result arrives, then takes the result's status, summary and evidence id", () => {
    let t = reduceTrace(EMPTY_TRACE, {
      type: "tool_call",
      id: "c1",
      name: "pathStats",
      args: { archetype: "jump" },
      by: "agent",
    });
    expect(t.items[0]).toMatchObject({
      kind: "call",
      status: "running",
      label: "Count outcomes on the jump route",
      by: "agent",
    });
    t = reduceTrace(t, {
      type: "tool_result",
      id: "c1",
      name: "pathStats",
      summary: "65 twins",
      isError: false,
      by: "agent",
      evidenceId: "p2",
    });
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ status: "ok", summary: "65 twins", evidenceId: "p2" });
  });

  it("a failed call shows as failed with the reason, and no evidence id", () => {
    let t = reduceTrace(EMPTY_TRACE, {
      type: "tool_call",
      id: "c1",
      name: "findTwins",
      args: {},
      by: "agent",
    });
    t = reduceTrace(t, {
      type: "tool_result",
      id: "c1",
      name: "findTwins",
      summary: "findTwins: bad argument",
      isError: true,
      by: "agent",
    });
    expect(t.items[0]).toMatchObject({ status: "error", summary: "findTwins: bad argument" });
    expect("evidenceId" in (t.items[0] as object)).toBe(false);
  });

  it("a result with no earlier call becomes one finished item instead of being lost", () => {
    const t = reduceTrace(EMPTY_TRACE, {
      type: "tool_result",
      id: "x",
      name: "compBands",
      summary: "ok",
      isError: false,
      by: "engine",
      evidenceId: "e9",
    });
    expect(t.items).toEqual([
      expect.objectContaining({ kind: "call", status: "ok", by: "engine", evidenceId: "e9" }),
    ]);
  });

  it("two calls with different ids are tracked separately, and a result updates only its own call", () => {
    let t = EMPTY_TRACE;
    for (const id of ["a", "b"])
      t = reduceTrace(t, { type: "tool_call", id, name: "pathStats", args: {}, by: "agent" });
    t = reduceTrace(t, {
      type: "tool_result",
      id: "b",
      name: "pathStats",
      summary: "done",
      isError: false,
      by: "agent",
    });
    expect(t.items.map((i) => i.kind === "call" && i.status)).toEqual(["running", "ok"]);
  });

  it("does not change the trace it was given", () => {
    const before = traceOf([{ type: "stage", stage: "gathering" }]);
    const copy: unknown = JSON.parse(JSON.stringify(before));
    reduceTrace(before, { type: "note", message: "x" });
    expect(before).toEqual(copy);
  });

  it("ignores an event of a kind it does not know", () => {
    const t = reduceTrace(EMPTY_TRACE, { type: "mystery" } as unknown as AgentEvent);
    expect(t).toBe(EMPTY_TRACE);
  });

  it("keeps at most MAX_TRACE_ITEMS items and says it dropped some", () => {
    let t = EMPTY_TRACE;
    for (let i = 0; i < MAX_TRACE_ITEMS + 25; i++) t = reduceTrace(t, { type: "note", message: `n${i}` });
    expect(t.items).toHaveLength(MAX_TRACE_ITEMS);
    expect(t.truncated).toBe(true);
    expect(t.items.at(-1)).toEqual({ kind: "note", message: `n${MAX_TRACE_ITEMS - 1}` });
  });

  it("a stage keeps its revision round and has a plain label for every stage", () => {
    const t = reduceTrace(EMPTY_TRACE, { type: "stage", stage: "revising", round: 2 });
    expect(t.items[0]).toMatchObject({ kind: "stage", round: 2, label: STAGE_LABEL.revising });
    for (const label of Object.values(STAGE_LABEL)) expect(label.length).toBeGreaterThan(4);
  });
});

describe("describeCall", () => {
  it("words each tool, and never dumps arguments", () => {
    expect(describeCall("findTwins", { remote: true, secret: "x" })).toBe(
      "Find comparable engineers in the cohort",
    );
    expect(describeCall("pathStats", { archetype: "climb", twinsEvidenceId: "e1" })).toBe(
      "Count outcomes on the climb route",
    );
    expect(describeCall("pathStats", "nonsense")).toBe("Count outcomes on a route");
    expect(describeCall("compBands", undefined)).toBe("Look up pay bands");
    expect(describeCall("x".repeat(100), null)).toHaveLength("Call ".length + 40);
  });
});

describe("the Skeptic's objections", () => {
  const rejections = [
    rejection(),
    rejection({ code: "ungrounded_number", claimText: "a 95% chance" }),
    rejection({ claimText: "second n problem", routeIndex: 1 }),
    rejection({ code: "x", source: "critic", claimText: "sounds promised" }),
  ];
  it("are grouped by kind in first-seen order, with plain titles; the model reviewer is its own group", () => {
    const groups = groupRejections(rejections);
    expect(groups.map((g) => g.code)).toEqual(["n_mismatch", "ungrounded_number", "critic"]);
    expect(groups[0]?.title).toBe("Sample size does not match the evidence");
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[2]?.title).toBe("Raised by the model-based reviewer");
  });
  it("an unknown code gets a readable title, not the raw code", () => {
    expect(groupRejections([rejection({ code: "brand_new_code" })])[0]?.title).toBe("brand new code");
  });
  it("headline: approved says no objections remain; rejected counts them, singular for one; later rounds say which", () => {
    expect(verdictHeadline({ round: 0, approved: true, rejections: [] })).toBe(
      "First check: approved, no objections remain",
    );
    expect(verdictHeadline({ round: 0, approved: false, rejections })).toBe("First check: 4 objections");
    expect(verdictHeadline({ round: 1, approved: false, rejections: [rejection()] })).toBe(
      "Check after revision 1: 1 objection",
    );
    expect(verdictHeadline({ round: 2, approved: true, rejections: [] })).toBe(
      "Check after revision 2: approved, no objections remain",
    );
  });
  it("a run with two checks reports one revision, singular", () => {
    const t = traceOf([
      { type: "verdict", round: 0, approved: false, rejections: [rejection()], notes: [] },
      { type: "verdict", round: 1, approved: true, rejections: [], notes: [] },
    ]);
    expect(traceSummary(t)).toBe(
      "0 evidence lookups, all chosen by the Planner, 2 Skeptic checks, 1 revision",
    );
  });
  it("a verdict keeps its rejections and notes exactly as streamed (nothing is staged or trimmed)", () => {
    const t = traceOf([{ type: "verdict", round: 0, approved: false, rejections, notes: ["one note"] }]);
    expect(t.items[0]).toMatchObject({ kind: "verdict", rejections, notes: ["one note"] });
  });
});

describe("currentStage", () => {
  it("is undefined before any stage and follows the latest stage", () => {
    expect(currentStage(EMPTY_TRACE)).toBeUndefined();
    const t = traceOf([
      { type: "stage", stage: "gathering" },
      { type: "note", message: "x" },
      { type: "stage", stage: "auditing" },
    ]);
    expect(currentStage(t)).toBe(STAGE_LABEL.auditing);
  });
});

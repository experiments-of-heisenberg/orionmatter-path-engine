/** Trace edges: odd tool names and arguments, repeated results, late events, and every plural. */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/lib/agents";
import type { Rejection } from "../src/lib/schemas";
import {
  EMPTY_TRACE,
  STAGE_LABEL,
  describeCall,
  groupRejections,
  reduceTrace,
  traceOf,
  traceSummary,
  verdictHeadline,
} from "../src/ui/trace";

const rejection = (over: Partial<Rejection> = {}): Rejection => ({
  code: "n_mismatch",
  source: "verifier",
  routeIndex: 0,
  claimText: "Twins took 20 months (n=99)",
  reason: "n does not match the evidence",
  ...over,
});

describe("describeCall with odd names and arguments", () => {
  it("never throws on arrays, numbers, huge objects or missing arguments, and never dumps them", () => {
    const huge: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) huge[`key${i}`] = "x".repeat(100);
    expect(describeCall("pathStats", [1, 2, 3])).toBe("Count outcomes on a route");
    expect(describeCall("pathStats", 42)).toBe("Count outcomes on a route");
    expect(describeCall("findTwins", huge)).toBe("Find comparable engineers in the cohort");
    expect(describeCall("compBands", undefined)).toBe("Look up pay bands");
    expect(describeCall("skillStats", null)).toBe("Compare engineers with and without a skill");
  });

  it("cuts an unknown name to 40 characters, without escaping: markup passes through for React to escape", () => {
    expect(describeCall("x".repeat(100), null)).toBe(`Call ${"x".repeat(40)}`);
    expect(describeCall("<img src=x onerror=alert(1)>", {})).toBe("Call <img src=x onerror=alert(1)>");
    expect(describeCall("trouverDesJumeaux🔍chercher", {})).toContain("🔍");
  });

  it("states: a surrogate pair cut at 40 leaves a lone high surrogate at the end", () => {
    const name = `${"a".repeat(39)}😀${"b".repeat(10)}`;
    const label = describeCall(name, {});
    expect(label).toHaveLength("Call ".length + 40);
    // The slice lands between the pair, so the label ends on a lone high surrogate (d83d).
    expect(label.charCodeAt(label.length - 1)).toBe(0xd83d);
  });
});

describe("reduceTrace with repeated and odd events", () => {
  it("states: a second result for the same call id overwrites the first (the later one wins)", () => {
    let t = reduceTrace(EMPTY_TRACE, {
      type: "tool_call",
      id: "c1",
      name: "pathStats",
      args: {},
      by: "agent",
    });
    t = reduceTrace(t, {
      type: "tool_result",
      id: "c1",
      name: "pathStats",
      summary: "first",
      isError: false,
      by: "agent",
      evidenceId: "e1",
    });
    t = reduceTrace(t, {
      type: "tool_result",
      id: "c1",
      name: "pathStats",
      summary: "second",
      isError: false,
      by: "agent",
      evidenceId: "e2",
    });
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ status: "ok", summary: "second", evidenceId: "e2" });
  });

  it("states: two calls with the same id are both kept, and a result updates only the first", () => {
    let t = EMPTY_TRACE;
    t = reduceTrace(t, { type: "tool_call", id: "dup", name: "findTwins", args: {}, by: "agent" });
    t = reduceTrace(t, { type: "tool_call", id: "dup", name: "compBands", args: {}, by: "engine" });
    t = reduceTrace(t, {
      type: "tool_result",
      id: "dup",
      name: "findTwins",
      summary: "done",
      isError: false,
      by: "agent",
    });
    expect(t.items).toHaveLength(2);
    expect(t.items.map((i) => i.kind === "call" && i.status)).toEqual(["ok", "running"]);
  });

  it("keeps a verdict's rejections exactly as streamed, even with routeIndex -1 and no stepIndex", () => {
    const odd = rejection({ routeIndex: -1, stepIndex: undefined });
    const t = reduceTrace(EMPTY_TRACE, {
      type: "verdict",
      round: 0,
      approved: false,
      rejections: [odd],
      notes: [],
    });
    expect(t.items[0]).toMatchObject({ kind: "verdict", rejections: [odd] });
  });

  it("a stage with an unknown name falls back to the raw name as its label", () => {
    const t = reduceTrace(EMPTY_TRACE, { type: "stage", stage: "daydreaming" } as unknown as AgentEvent);
    expect(t.items[0]).toMatchObject({ kind: "stage", label: "daydreaming" });
    expect(t.finished).toBe(false);
  });

  it("states: events arriving after `done` are still appended (only the plan run guards on phase)", () => {
    let t = traceOf([{ type: "stage", stage: "done" }]);
    expect(t.finished).toBe(true);
    t = reduceTrace(t, { type: "note", message: "late" });
    expect(t.items).toHaveLength(2);
    expect(t.finished).toBe(true);
  });
});

describe("many objections", () => {
  it("groups 200 rejections of 13 codes without loss, in first-seen order", () => {
    const codes = Array.from({ length: 13 }, (_, i) => `code_${i}`);
    const rejections = Array.from({ length: 200 }, (_, i) =>
      rejection({ code: codes[i % codes.length] ?? "code_0", claimText: `claim ${i}` }),
    );
    const groups = groupRejections(rejections);
    expect(groups).toHaveLength(13);
    expect(groups.map((g) => g.code)).toEqual(codes);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(200);
    expect(groups[0]?.items).toHaveLength(16); // 200 = 13*15 + 5, so the first five groups hold 16
    expect(groups[12]?.items).toHaveLength(15);
  });

  it("the headline counts 1000 objections", () => {
    const rejections = Array.from({ length: 1000 }, (_, i) => rejection({ claimText: `claim ${i}` }));
    expect(verdictHeadline({ round: 0, approved: false, rejections })).toBe("First check: 1000 objections");
  });
});

describe("traceSummary singular and plural", () => {
  const call = (id: string, by: "agent" | "engine" = "agent"): AgentEvent[] => [
    { type: "tool_call", id, name: "findTwins", args: {}, by },
    { type: "tool_result", id, name: "findTwins", summary: "ok", isError: false, by },
  ];
  const check = (round: number, approved: boolean): AgentEvent => ({
    type: "verdict",
    round,
    approved,
    rejections: approved ? [] : [rejection()],
    notes: [],
  });

  it.each([
    [0, 0, "0 evidence lookups, all chosen by the Planner, 0 Skeptic checks, 0 revisions"],
    [1, 0, "1 evidence lookup, all chosen by the Planner, 0 Skeptic checks, 0 revisions"],
    [2, 0, "2 evidence lookups, all chosen by the Planner, 0 Skeptic checks, 0 revisions"],
  ])("%i calls and %i checks reads %s", (calls, _checks, sentence) => {
    const events = Array.from({ length: calls }, (_, i) => call(`c${i}`)).flat();
    expect(traceSummary(traceOf(events))).toBe(sentence);
  });

  it("1 check with 0 revisions, and 2 checks with 1 revision, read singular and plural", () => {
    expect(traceSummary(traceOf([check(0, true)]))).toBe(
      "0 evidence lookups, all chosen by the Planner, 1 Skeptic check, 0 revisions",
    );
    expect(traceSummary(traceOf([check(0, false), check(1, true)]))).toBe(
      "0 evidence lookups, all chosen by the Planner, 2 Skeptic checks, 1 revision",
    );
    expect(traceSummary(traceOf([check(0, false), check(1, false), check(2, true)]))).toBe(
      "0 evidence lookups, all chosen by the Planner, 3 Skeptic checks, 2 revisions",
    );
  });

  it("one lookup filled in by code mixes singular counts on both halves", () => {
    expect(traceSummary(traceOf([...call("a"), ...call("b", "engine"), check(0, true)]))).toBe(
      "2 evidence lookups, 1 filled in by code, 1 Skeptic check, 0 revisions",
    );
  });
});

describe("STAGE_LABEL covers the AgentEvent stages", () => {
  it("has an entry for every stage in the type, derived from a literal list", () => {
    const stages = [
      "reading",
      "protecting",
      "interpreting",
      "explaining",
      "gathering",
      "composing",
      "auditing",
      "revising",
      "done",
    ];
    expect(Object.keys(STAGE_LABEL).sort()).toEqual([...stages].sort());
  });
});

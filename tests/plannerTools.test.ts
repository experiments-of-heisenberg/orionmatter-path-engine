/**
 * Unit tests for the Planner's model-facing tools: the executor is driven directly, with
 * no model client, so every success and failure path is deterministic and offline.
 */
import { describe, expect, it } from "vitest";
import { createPlannerExecutor, PLANNER_TOOLS, type AgentEvent } from "../src/lib/agents";
import { EvidenceLedger } from "../src/lib/tools";
import { constraints, goal, input, profile } from "./helpers/fixturesData";

type Executor = ReturnType<typeof createPlannerExecutor>;

/** A ledger with predictable ids (ev_1, ev_2, ...) plus an event collector. */
function setup(): { ledger: EvidenceLedger; events: AgentEvent[]; execute: Executor } {
  let n = 0;
  const ledger = new EvidenceLedger({ newId: () => `ev_${++n}` });
  const events: AgentEvent[] = [];
  const execute = createPlannerExecutor(ledger, input, (event) => events.push(event));
  return { ledger, events, execute };
}

/** Call one tool through the executor; returns the raw JSON string the model would see. */
function call(execute: Executor, id: string, name: string, args: unknown): Promise<string> {
  return Promise.resolve(execute({ id, name, args }));
}

/** Parse a model-facing result as a plain object. */
function resultOf(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

/** The tool_result events in order. */
function resultsOf(events: AgentEvent[]): AgentEvent[] {
  return events.filter((event) => event.type === "tool_result");
}

describe("findTwins", () => {
  it("records one evidence with the input's profile and goal when called with no args", async () => {
    const { ledger, execute } = setup();
    const json = resultOf(await call(execute, "c1", "findTwins", undefined));
    expect(json.evidenceId).toBe("ev_1");
    expect(ledger.all()).toHaveLength(1);
    const recorded = ledger.get("ev_1");
    if (recorded === undefined || recorded.tool !== "findTwins") {
      throw new Error("test bug: expected one findTwins evidence");
    }
    expect(recorded.args.profile).toEqual(input.profile);
    expect(recorded.args.goal).toEqual(input.goal);
    expect(recorded.args.constraints).toEqual(input.constraints);
  });

  it("ignores profile and goal keys smuggled into the model's args", async () => {
    const { ledger, execute } = setup();
    const impostor = {
      roleFamily: "sre",
      level: "L3",
      yearsExperience: 1,
      stack: [],
      region: "US-west",
      milestones: [],
    };
    await call(execute, "c1", "findTwins", {
      profile: impostor,
      goal: { targetLevel: "L7", label: "other" },
    });
    const recorded = ledger.get("ev_1");
    if (recorded === undefined || recorded.tool !== "findTwins") {
      throw new Error("test bug: expected one findTwins evidence");
    }
    expect(recorded.args.profile).toEqual(profile);
    expect(recorded.args.goal).toEqual(goal);
  });

  it("{ remote: true } overrides only the remote knob", async () => {
    const { ledger, execute } = setup();
    await call(execute, "c1", "findTwins", { remote: true });
    const recorded = ledger.get("ev_1");
    if (recorded === undefined || recorded.tool !== "findTwins") {
      throw new Error("test bug: expected one findTwins evidence");
    }
    const recordedConstraints = recorded.args.constraints;
    if (recordedConstraints === undefined) throw new Error("test bug: expected constraints");
    expect(recordedConstraints.remote).toBe(true);
    expect(recordedConstraints.riskTolerance).toBe(input.constraints.riskTolerance);
    expect(recordedConstraints).toEqual({ ...constraints, remote: true });
  });

  it("returns evidenceId, n and a next hint, but never the twin id list", async () => {
    const { execute } = setup();
    const raw = await call(execute, "c1", "findTwins", {});
    const json = resultOf(raw);
    expect(json.evidenceId).toBe("ev_1");
    expect(typeof json.n).toBe("number");
    expect(json.next).toContain("twinsEvidenceId");
    expect(raw).not.toContain("syn_");
  });
});

describe("pathStats", () => {
  it("records evidence over exactly the referenced twin set", async () => {
    const { ledger, execute } = setup();
    const twins = resultOf(await call(execute, "c1", "findTwins", {}));
    const json = resultOf(
      await call(execute, "c2", "pathStats", { twinsEvidenceId: twins.evidenceId, archetype: "jump" }),
    );
    expect(json.evidenceId).toBe("ev_2");
    expect(typeof json.n).toBe("number");
    const twinsRecord = ledger.get("ev_1");
    const statsRecord = ledger.get("ev_2");
    if (twinsRecord === undefined || twinsRecord.tool !== "findTwins") {
      throw new Error("test bug: expected findTwins evidence");
    }
    if (statsRecord === undefined || statsRecord.tool !== "pathStats") {
      throw new Error("test bug: expected pathStats evidence");
    }
    expect(statsRecord.args.archetype).toBe("jump");
    expect(statsRecord.args.twinIds).toEqual(twinsRecord.result.twinIds);
  });

  it.each([
    ["unknown evidence id", { twinsEvidenceId: "ev_999", archetype: "climb" }],
    ["bad archetype", { twinsEvidenceId: "ev_1", archetype: "teleport" }],
    ["missing twinsEvidenceId", { archetype: "climb" }],
  ])("returns an error result for %s", async (_label, args) => {
    const { ledger, events, execute } = setup();
    await call(execute, "c1", "findTwins", {});
    const before = ledger.all().length;
    const json = resultOf(await call(execute, "c2", "pathStats", args));
    expect(typeof json.error).toBe("string");
    expect(ledger.all()).toHaveLength(before);
    const [result] = resultsOf(events).slice(-1);
    expect(result?.type === "tool_result" && result.isError).toBe(true);
  });

  it("rejects the evidenceId of a non-findTwins call", async () => {
    const { ledger, events, execute } = setup();
    const comp = resultOf(await call(execute, "c1", "compBands", { level: "L6", region: "IN-south" }));
    const json = resultOf(
      await call(execute, "c2", "pathStats", {
        twinsEvidenceId: comp.evidenceId,
        archetype: "climb",
      }),
    );
    expect(json.error).toContain("not the evidenceId of a findTwins call");
    expect(ledger.all().filter((e) => e.tool === "pathStats")).toHaveLength(0);
    const [result] = resultsOf(events).slice(-1);
    expect(result?.type === "tool_result" && result.isError).toBe(true);
  });
});

describe("compBands", () => {
  it("records evidence for valid args", async () => {
    const { ledger, execute } = setup();
    const json = resultOf(await call(execute, "c1", "compBands", { level: "L6", region: "IN-south" }));
    expect(json.evidenceId).toBe("ev_1");
    const recorded = ledger.get("ev_1");
    expect(recorded?.tool).toBe("compBands");
  });

  it("produces an error result when level is not a string", async () => {
    const { ledger, events, execute } = setup();
    const json = resultOf(await call(execute, "c1", "compBands", { level: 42, region: "IN-south" }));
    expect(typeof json.error).toBe("string");
    expect(ledger.all()).toHaveLength(0);
    const [result] = resultsOf(events);
    expect(result?.type === "tool_result" && result.isError).toBe(true);
  });
});

describe("unknown tool", () => {
  it("returns an error naming the available tools and records nothing", async () => {
    const { ledger, events, execute } = setup();
    const json = resultOf(await call(execute, "c1", "deleteEverything", {}));
    expect(json.error).toContain("Unknown tool");
    expect(json.error).toContain("findTwins");
    expect(json.error).toContain("pathStats");
    expect(json.error).toContain("compBands");
    expect(ledger.all()).toHaveLength(0);
    const [result] = resultsOf(events);
    expect(result?.type === "tool_result" && result.isError).toBe(true);
  });
});

describe("emitted events", () => {
  it("emits tool_call first and then tool_result for every call", async () => {
    const { events, execute } = setup();
    await call(execute, "c1", "findTwins", {});
    await call(execute, "c2", "nope", {});
    expect(events.map((event) => event.type)).toEqual([
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
    ]);
    expect(
      events.map((event) => (event.type === "tool_call" || event.type === "tool_result" ? event.id : "?")),
    ).toEqual(["c1", "c1", "c2", "c2"]);
  });

  it("a successful tool_result carries evidenceId, a summary and by agent", async () => {
    const { events, execute } = setup();
    await call(execute, "c1", "findTwins", {});
    const [callEvent, resultEvent] = events;
    expect(callEvent?.type).toBe("tool_call");
    if (resultEvent?.type !== "tool_result") throw new Error("test bug: expected a tool_result");
    expect(resultEvent.isError).toBe(false);
    expect(resultEvent.evidenceId).toBe("ev_1");
    expect(resultEvent.summary.length).toBeGreaterThan(0);
    expect(resultEvent.by).toBe("agent");
  });

  it("a failed tool_result has isError and no evidenceId", async () => {
    const { events, execute } = setup();
    await call(execute, "c1", "nope", {});
    const [, resultEvent] = events;
    if (resultEvent?.type !== "tool_result") throw new Error("test bug: expected a tool_result");
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.evidenceId).toBeUndefined();
  });
});

describe("PLANNER_TOOLS", () => {
  it("names exactly the three planner tools", () => {
    expect(PLANNER_TOOLS.map((tool) => tool.name)).toEqual(["findTwins", "pathStats", "compBands"]);
  });

  it("describes every tool's parameters as a plain object schema", () => {
    for (const tool of PLANNER_TOOLS) {
      expect(tool.parameters["type"]).toBe("object");
      expect("$schema" in tool.parameters).toBe(false);
    }
  });

  it("requires twinsEvidenceId and a climb/jump/pivot archetype for pathStats", () => {
    const pathStats = PLANNER_TOOLS.find((tool) => tool.name === "pathStats");
    expect(pathStats?.parameters["required"]).toEqual(
      expect.arrayContaining(["twinsEvidenceId", "archetype"]),
    );
    expect(pathStats?.parameters["properties"]).toMatchObject({
      archetype: { enum: ["climb", "jump", "pivot"] },
    });
  });
});

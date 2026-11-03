/**
 * Tests for agent events: the discarding emitter and the event vocabulary itself.
 */
import { describe, expect, it } from "vitest";
import { noEmit, type AgentEvent, type Emit } from "../src/lib/agents";

/** One event of each of the four AgentEvent types. */
const everyType: AgentEvent[] = [
  { type: "stage", stage: "gathering" },
  { type: "tool_call", id: "c1", name: "findTwins", args: {}, by: "agent" },
  {
    type: "tool_result",
    id: "c1",
    name: "findTwins",
    summary: "findTwins: 150 comparable engineers",
    isError: false,
    by: "agent",
    evidenceId: "ev_1",
  },
  { type: "note", message: "the engine filled in a gap" },
];

describe("noEmit", () => {
  it("accepts every event type and returns undefined", () => {
    for (const event of everyType) {
      expect(noEmit(event)).toBeUndefined();
    }
  });
});

describe("Emit", () => {
  it("accepts an AgentEvent of each of the four types", () => {
    const seen: AgentEvent[] = [];
    const emit: Emit = (event) => {
      seen.push(event);
    };
    for (const event of everyType) {
      emit(event);
    }
    expect(seen.map((event) => event.type)).toEqual(["stage", "tool_call", "tool_result", "note"]);
  });
});

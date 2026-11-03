/** Tests for the tool-calling loop: normal flow, untrusted arguments, errors, and the call cap. */
import { describe, expect, it } from "vitest";
import { callTools, createMockClient, reply, runToolLoop, type ToolLoopEvent } from "../src/lib/model";

const tools = [
  { name: "lookup", description: "look something up", parameters: { type: "object", properties: {} } },
];
const base = {
  label: "planner",
  target: "spark" as const,
  messages: [{ role: "user" as const, content: "go" }],
  tools,
};

describe("runToolLoop", () => {
  it("runs a requested tool, feeds the result back, and returns the final answer", async () => {
    const client = createMockClient([callTools({ name: "lookup", args: { q: "x" } }), reply("done")]);
    const seen: unknown[] = [];
    const out = await runToolLoop({
      client,
      request: base,
      execute: ({ name, args }) => {
        seen.push({ name, args });
        return JSON.stringify({ answer: 42 });
      },
    });
    expect(out.final.text).toBe("done");
    expect(out.toolCallCount).toBe(1);
    expect(out.hitLimit).toBe(false);
    expect(seen).toEqual([{ name: "lookup", args: { q: "x" } }]);
    // The second model call must contain the assistant tool call and the tool result, in order.
    const second = client.requests[1]?.messages ?? [];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(second[2]).toMatchObject({ role: "tool", toolCallId: "call_1", content: '{"answer":42}' });
  });

  it("supports several tool calls in one turn, run in order", async () => {
    const order: string[] = [];
    const client = createMockClient([
      callTools({ name: "lookup", args: { n: 1 } }, { name: "lookup", args: { n: 2 } }),
      reply("ok"),
    ]);
    const out = await runToolLoop({
      client,
      request: base,
      execute: ({ args }) => (order.push(JSON.stringify(args)), "{}"),
    });
    expect(order).toEqual(['{"n":1}', '{"n":2}']);
    expect(out.toolCallCount).toBe(2);
  });

  it("feeds invalid-JSON arguments back as an error instead of crashing or calling the tool", async () => {
    const client = createMockClient([callTools({ name: "lookup", args: "{not json" }), reply("recovered")]);
    let called = false;
    const out = await runToolLoop({ client, request: base, execute: () => ((called = true), "{}") });
    expect(called).toBe(false);
    const toolMessage = client.requests[1]?.messages.at(-1);
    expect(JSON.stringify(toolMessage)).toContain("not valid JSON");
    expect(out.final.text).toBe("recovered");
  });

  it("converts a throwing tool into an error result the model can see", async () => {
    const client = createMockClient([callTools({ name: "lookup", args: {} }), reply("ok")]);
    const events: ToolLoopEvent[] = [];
    await runToolLoop({
      client,
      request: base,
      execute: () => {
        throw new Error("tool exploded");
      },
      onEvent: (event) => events.push(event),
    });
    expect(JSON.stringify(client.requests[1]?.messages.at(-1))).toContain("tool exploded");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: true });
  });

  it("emits a call event and a result event for each tool call", async () => {
    const client = createMockClient([callTools({ name: "lookup", args: { a: 1 } }), reply("ok")]);
    const events: ToolLoopEvent[] = [];
    await runToolLoop({ client, request: base, execute: () => "{}", onEvent: (e) => events.push(e) });
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
  });

  it("enforces the call cap: extra calls get an error, then the model must answer with tools off", async () => {
    const client = createMockClient([
      callTools({ name: "lookup", args: {} }, { name: "lookup", args: {} }, { name: "lookup", args: {} }),
      reply("final answer"),
    ]);
    let executed = 0;
    const events: ToolLoopEvent[] = [];
    const out = await runToolLoop({
      client,
      request: base,
      maxToolCalls: 2,
      execute: () => (executed++, "{}"),
      onEvent: (e) => events.push(e),
    });
    expect(executed).toBe(2); // the third call was not executed
    expect(out.hitLimit).toBe(true);
    expect(out.toolCallCount).toBe(2);
    expect(client.requests[1]?.toolChoice).toBe("none");
    expect(events.some((e) => e.type === "limit_reached")).toBe(true);
    const roles = client.requests[1]?.messages.map((m) => m.role);
    expect(roles?.filter((r) => r === "tool")).toHaveLength(3); // every call got an answer
  });

  it("keeps tool_choice auto until the cap is reached", async () => {
    const client = createMockClient([callTools({ name: "lookup", args: {} }), reply("ok")]);
    await runToolLoop({ client, request: base, execute: () => "{}" });
    expect(client.requests.map((r) => r.toolChoice)).toEqual(["auto", "auto"]);
  });

  it("labels each turn so logs and fixtures are distinguishable", async () => {
    const client = createMockClient([callTools({ name: "lookup", args: {} }), reply("ok")]);
    await runToolLoop({ client, request: base, execute: () => "{}" });
    expect(client.requests.map((r) => r.label)).toEqual(["planner:turn1", "planner:turn2"]);
  });
});

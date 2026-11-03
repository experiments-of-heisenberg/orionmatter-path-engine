/** Tests for the scriptable mock model client used by agent tests. */
import { describe, expect, it } from "vitest";
import { callTools, createMockClient, reply } from "../src/lib/model/mock";
import type { ChatRequest } from "../src/lib/model/types";

const request = (label: string): ChatRequest => ({
  label,
  target: "spark",
  messages: [{ role: "user", content: "hi" }],
});

describe("createMockClient", () => {
  it("plays scripted steps in order", async () => {
    const client = createMockClient([reply("first"), reply("second")]);
    expect((await client.chat(request("a"))).text).toBe("first");
    expect((await client.chat(request("b"))).text).toBe("second");
  });

  it("records every request in order", async () => {
    const client = createMockClient([reply("x"), reply("y")]);
    await client.chat(request("one"));
    await client.chat(request("two"));
    expect(client.requests.map((seen) => seen.label)).toEqual(["one", "two"]);
  });

  it("counts remaining steps down as they are consumed", async () => {
    const client = createMockClient([reply("x"), reply("y")]);
    expect(client.remaining).toBe(2);
    await client.chat(request("a"));
    expect(client.remaining).toBe(1);
    await client.chat(request("b"));
    expect(client.remaining).toBe(0);
  });

  it("rejects with a clear error naming the call when the script is exhausted", async () => {
    const client = createMockClient([reply("only")]);
    await client.chat(request("first"));
    await expect(client.chat(request("unexpected"))).rejects.toThrow(
      /script exhausted at call 2 \("unexpected"\)/,
    );
  });

  it("supports a function step that reads the incoming request", async () => {
    const client = createMockClient([(seen) => reply(`echo:${seen.label}`)]);
    expect((await client.chat(request("ping"))).text).toBe("echo:ping");
  });

  it("fills in defaults for anything a step omits", async () => {
    const client = createMockClient([{}]);
    const result = await client.chat(request("a"));
    expect(result).toMatchObject({
      text: "",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
      model: "mock",
    });
  });
});

describe("callTools", () => {
  it("builds sequential ids and keeps string args as they are", () => {
    const step = callTools(
      { name: "findTwins", args: { profile: "p" } },
      { name: "levelMap", args: '{"company":"acme"}' },
    );
    expect(step.finishReason).toBe("tool_calls");
    expect(step.toolCalls).toEqual([
      { id: "call_1", name: "findTwins", arguments: '{"profile":"p"}' },
      { id: "call_2", name: "levelMap", arguments: '{"company":"acme"}' },
    ]);
  });

  it("JSON-stringifies object args while passing string args through unchanged", () => {
    const raw = '{"already":"json"}';
    const [objectCall, stringCall] =
      callTools({ name: "a", args: { n: 1 } }, { name: "b", args: raw }).toolCalls ?? [];
    expect(objectCall?.arguments).toBe(JSON.stringify({ n: 1 }));
    expect(stringCall?.arguments).toBe(raw);
  });
});

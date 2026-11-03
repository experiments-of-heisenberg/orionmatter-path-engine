/**
 * Tests for the model client, run entirely against a fake transport. These cover the
 * behaviours that decide whether a demo survives a bad moment: retries, backoff,
 * token-budget escalation, timeouts, and fixture replay.
 */
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/lib/env";
import {
  createModelClient,
  FixtureMissError,
  MemoryFixtureStore,
  ModelConfigError,
  ModelEmptyResponseError,
  ModelHttpError,
  ModelProtocolError,
  ModelTimeoutError,
  fixtureKey,
  type ChatRequest,
} from "../src/lib/model";
import {
  errorResponse,
  okResponse,
  recordingSleep,
  scriptedTransport,
  testEnv,
} from "./helpers/fakeTransport";

const request: ChatRequest = {
  label: "test",
  target: "spark",
  messages: [{ role: "user", content: "hi" }],
};

/** Build a client wired to fakes. Returns the pieces tests assert on. */
function setup(steps: Parameters<typeof scriptedTransport>[0], env = testEnv) {
  const transport = scriptedTransport(steps);
  const { delays, sleep } = recordingSleep();
  const client = createModelClient(env, { transport, sleep, random: () => 0.5 });
  return { client, transport, delays };
}

const sentBody = (t: ReturnType<typeof scriptedTransport>, index = 0) =>
  JSON.parse(t.requests[index]?.body ?? "{}") as Record<string, unknown>;

describe("request building", () => {
  it("sends the right URL, auth header, model and defaults for the spark target", async () => {
    const { client, transport } = setup([okResponse()]);
    await client.chat(request);
    const sent = transport.requests[0];
    expect(sent?.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(sent?.headers.Authorization).toBe("Bearer test-meta-key");
    expect(sentBody(transport)).toMatchObject({ model: "muse-spark-1.3", max_completion_tokens: 4000 });
  });

  it("routes the open target to Baseten with its own key and model", async () => {
    const { client, transport } = setup([okResponse()]);
    await client.chat({ ...request, target: "open" });
    expect(transport.requests[0]?.url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(transport.requests[0]?.headers.Authorization).toBe("Bearer test-baseten-key");
    expect(sentBody(transport).model).toBe("meta-models/muse-spark-open-1026");
  });

  it("omits temperature and reasoning_effort unless the caller sets them", async () => {
    const { client, transport } = setup([okResponse(), okResponse()]);
    await client.chat(request);
    await client.chat({ ...request, temperature: 0.2, reasoningEffort: "low" });
    expect(sentBody(transport, 0)).not.toHaveProperty("temperature");
    expect(sentBody(transport, 0)).not.toHaveProperty("reasoning_effort");
    expect(sentBody(transport, 1)).toMatchObject({ temperature: 0.2, reasoning_effort: "low" });
  });

  it("refuses to call live without an API key, naming the target", async () => {
    const env = parseEnv({ USE_FIXTURES: "false", MODEL_API_KEY: "k-one-two", BASETEN_API_KEY: "k-three" });
    const keyless = { ...env, MODEL_API_KEY: undefined };
    const { client } = setup([], keyless);
    await expect(client.chat(request)).rejects.toThrow(ModelConfigError);
  });
});

describe("response handling", () => {
  it("returns text, usage, model and latency, and reports one attempt", async () => {
    let clock = 1000;
    const transport = scriptedTransport([
      okResponse({ content: "answer", completionTokens: 42, reasoningTokens: 7 }),
    ]);
    const client = createModelClient(testEnv, { transport, now: () => (clock += 250) });
    const result = await client.chat(request);
    expect(result).toMatchObject({
      text: "answer",
      finishReason: "stop",
      attempts: 1,
      latencyMs: 250,
      fromFixture: false,
      usage: { completionTokens: 42, reasoningTokens: 7 },
    });
  });

  it("surfaces tool calls with their raw argument strings", async () => {
    const { client } = setup([
      okResponse({
        content: null,
        finish: "tool_calls",
        toolCalls: [{ id: "c1", name: "findTwins", arguments: '{"x":1}' }],
      }),
    ]);
    const result = await client.chat(request);
    expect(result.toolCalls).toEqual([{ id: "c1", name: "findTwins", arguments: '{"x":1}' }]);
  });

  it("exposes visible reasoning when the provider returns it", async () => {
    const { client } = setup([okResponse({ reasoning: "thinking out loud" })]);
    expect((await client.chat(request)).reasoning).toBe("thinking out loud");
  });

  it("turns a malformed 200 into a ModelProtocolError instead of crashing later", async () => {
    const { client } = setup([{ status: 200, text: '{"nope": true}', retryAfter: null }]);
    await expect(client.chat(request)).rejects.toThrow(ModelProtocolError);
    const { client: client2 } = setup([{ status: 200, text: "<html>gateway</html>", retryAfter: null }]);
    await expect(client2.chat(request)).rejects.toThrow(ModelProtocolError);
  });
});

describe("retries", () => {
  it("retries a 429 and succeeds, sleeping with exponential backoff", async () => {
    const { client, delays } = setup([errorResponse(429), errorResponse(503), okResponse()]);
    const result = await client.chat(request);
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it("honours Retry-After over its own schedule", async () => {
    const { client, delays } = setup([errorResponse(429, "slow down", "2"), okResponse()]);
    await client.chat(request);
    expect(delays).toEqual([2000]);
  });

  it("gives up after the retry limit and throws the last HTTP error", async () => {
    const { client, transport } = setup([
      errorResponse(500, "a"),
      errorResponse(500, "b"),
      errorResponse(500, "c"),
    ]);
    const failure = await client.chat(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ModelHttpError);
    expect((failure as ModelHttpError).status).toBe(500);
    expect(transport.requests).toHaveLength(3); // 1 attempt + 2 retries
  });

  it("does not retry client errors such as 400 or 401", async () => {
    for (const status of [400, 401, 404]) {
      const { client, transport } = setup([errorResponse(status, "nope")]);
      await expect(client.chat(request)).rejects.toThrow(ModelHttpError);
      expect(transport.requests).toHaveLength(1);
    }
  });

  it("retries timeouts and network failures", async () => {
    const { client, transport } = setup([new ModelTimeoutError(1000), okResponse()]);
    expect((await client.chat(request)).attempts).toBe(2);
    expect(transport.requests).toHaveLength(2);
  });

  it("never puts the API key in an error message", async () => {
    const { client } = setup([errorResponse(401, "bad key", null)]);
    const failure = (await client.chat(request).catch((error: unknown) => error)) as Error;
    expect(failure.message).not.toContain("test-meta-key");
  });
});

describe("token-budget escalation (Muse Spark spends the budget on hidden reasoning)", () => {
  it("doubles the budget and retries when the reply is empty and truncated", async () => {
    const { client, transport } = setup([
      okResponse({ content: "", finish: "length", reasoningTokens: 4000 }),
      okResponse({ content: "finally" }),
    ]);
    const result = await client.chat({ ...request, maxCompletionTokens: 200 });
    expect(result.text).toBe("finally");
    expect(result.attempts).toBe(2);
    expect(sentBody(transport, 0).max_completion_tokens).toBe(200);
    expect(sentBody(transport, 1).max_completion_tokens).toBe(400);
  });

  it("stops escalating at the cap and throws a clear error", async () => {
    const empty = () => okResponse({ content: "", finish: "length" });
    const { client } = setup([empty(), empty(), empty(), empty()]);
    await expect(client.chat({ ...request, maxCompletionTokens: 10_000 })).rejects.toThrow(
      ModelEmptyResponseError,
    );
  });

  it("does not escalate an empty reply that was not caused by truncation", async () => {
    const { client, transport } = setup([okResponse({ content: "", finish: "stop" })]);
    await expect(client.chat(request)).rejects.toThrow(ModelEmptyResponseError);
    expect(transport.requests).toHaveLength(1);
  });

  it("treats a reply with only tool calls as non-empty", async () => {
    const { client } = setup([
      okResponse({ content: "", finish: "tool_calls", toolCalls: [{ id: "c", name: "t", arguments: "{}" }] }),
    ]);
    expect((await client.chat(request)).toolCalls).toHaveLength(1);
  });
});

describe("fixtures", () => {
  it("records a live response, then replays it without any network call", async () => {
    const store = new MemoryFixtureStore();
    const recordTransport = scriptedTransport([okResponse({ content: "recorded answer" })]);
    const recorder = createModelClient(testEnv, {
      transport: recordTransport,
      fixtures: store,
      fixtureMode: "record",
    });
    await recorder.chat(request);
    expect(store.entries.size).toBe(1);

    const replayTransport = scriptedTransport([]); // any network call would throw
    const replayer = createModelClient(testEnv, {
      transport: replayTransport,
      fixtures: store,
      fixtureMode: "replay",
    });
    const replayed = await replayer.chat(request);
    expect(replayed).toMatchObject({ text: "recorded answer", fromFixture: true, attempts: 0, latencyMs: 0 });
    expect(replayTransport.requests).toHaveLength(0);
  });

  it("replay needs no API keys, so the demo works offline", async () => {
    const store = new MemoryFixtureStore();
    const env = parseEnv({ USE_FIXTURES: "true" });
    const key = fixtureKey(request, env.META_MODEL_SPARK);
    await store.put(key, "test", {
      text: "offline",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
      model: "m",
    });
    const client = createModelClient(env, { fixtures: store });
    expect((await client.chat(request)).text).toBe("offline");
  });

  it("throws a descriptive FixtureMissError in replay mode when nothing was recorded", async () => {
    const client = createModelClient(parseEnv({ USE_FIXTURES: "true" }), {
      fixtures: new MemoryFixtureStore(),
    });
    await expect(client.chat(request)).rejects.toThrow(FixtureMissError);
  });

  it("keys on request content, not on the label or timeout", () => {
    const base = fixtureKey(request, "m");
    expect(fixtureKey({ ...request, label: "other", timeoutMs: 5 }, "m")).toBe(base);
    expect(fixtureKey({ ...request, messages: [{ role: "user", content: "different" }] }, "m")).not.toBe(
      base,
    );
    expect(fixtureKey({ ...request, reasoningEffort: "low" }, "m")).not.toBe(base);
    expect(fixtureKey(request, "other-model")).not.toBe(base);
  });
});

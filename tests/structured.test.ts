/** Tests for structured output: validation, the single repair retry, and failure reporting. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callTools,
  chatStructured,
  createMockClient,
  ModelParseError,
  reply,
  type ChatRequest,
} from "../src/lib/model";

const Answer = z.object({ level: z.string(), years: z.number().int().min(0) });
const request: ChatRequest = {
  label: "intake",
  target: "spark",
  messages: [{ role: "user", content: "parse this" }],
};

describe("chatStructured", () => {
  it("returns validated data on the first try without a repair", async () => {
    const client = createMockClient([reply('{"level":"L5","years":7}')]);
    const out = await chatStructured(client, request, Answer);
    expect(out.data).toEqual({ level: "L5", years: 7 });
    expect(out.repaired).toBe(false);
    expect(client.requests).toHaveLength(1);
  });

  it("accepts JSON wrapped in a fence or prose", async () => {
    const client = createMockClient([reply('Here you go:\n```json\n{"level":"L4","years":3}\n```')]);
    expect((await chatStructured(client, request, Answer)).data.level).toBe("L4");
  });

  it("appends the JSON Schema to the prompt by default, and can be told not to", async () => {
    const withSchema = createMockClient([reply('{"level":"L5","years":1}')]);
    await chatStructured(withSchema, request, Answer);
    const last = withSchema.requests[0]?.messages.at(-1);
    expect(JSON.stringify(last)).toContain("JSON Schema");
    expect(JSON.stringify(last)).toContain("years");

    const without = createMockClient([reply('{"level":"L5","years":1}')]);
    await chatStructured(without, request, Answer, { includeSchemaInPrompt: false });
    expect(without.requests[0]?.messages).toHaveLength(1);
  });

  it("repairs once: shows the model its output and the exact validation errors", async () => {
    const client = createMockClient([
      reply('{"level":"L5","years":"seven"}'),
      reply('{"level":"L5","years":7}'),
    ]);
    const out = await chatStructured(client, request, Answer);
    expect(out.repaired).toBe(true);
    expect(out.repairReason).toContain("years"); // says which field failed, without echoing model text
    expect(out.data.years).toBe(7);
    const repairMessages = client.requests[1]?.messages ?? [];
    expect(JSON.stringify(repairMessages)).toContain("seven"); // its own bad output
    expect(JSON.stringify(repairMessages)).toContain("failed validation");
    expect(client.requests[1]?.label).toBe("intake:repair");
  });

  it("repairs a reply that was not JSON at all", async () => {
    const client = createMockClient([reply("I cannot do that"), reply('{"level":"L3","years":0}')]);
    expect((await chatStructured(client, request, Answer)).repaired).toBe(true);
  });

  it("throws ModelParseError after the repair retry also fails, and makes no third call", async () => {
    const client = createMockClient([reply('{"bad":1}'), reply('{"still":"bad"}')]);
    const failure = await chatStructured(client, request, Answer).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ModelParseError);
    expect((failure as ModelParseError).issues).toContain("level");
    expect(client.requests).toHaveLength(2);
  });

  it("keeps the model's raw reply on the error for debugging, but not in its message", async () => {
    const client = createMockClient([reply("nope"), reply("secret-ish text")]);
    const failure = (await chatStructured(client, request, Answer).catch(
      (error: unknown) => error,
    )) as ModelParseError;
    expect(failure.lastText).toBe("secret-ish text");
    expect(failure.message).not.toContain("secret-ish text");
  });

  it("reports completion tokens summed across the first call and the repair", async () => {
    const usage = (completionTokens: number) => ({ promptTokens: 0, completionTokens, reasoningTokens: 0 });
    const client = createMockClient([
      { text: "{}", usage: usage(10) },
      { text: '{"level":"L5","years":1}', usage: usage(5) },
    ]);
    expect((await chatStructured(client, request, Answer)).totalTokens).toBe(15);
  });

  it("reports only the first call's tokens when no repair was needed", async () => {
    const client = createMockClient([
      {
        text: '{"level":"L5","years":1}',
        usage: { promptTokens: 0, completionTokens: 9, reasoningTokens: 0 },
      },
    ]);
    expect((await chatStructured(client, request, Answer)).totalTokens).toBe(9);
  });

  it("treats a reply that only requests tools (no text) as invalid output and repairs it", async () => {
    const client = createMockClient([callTools({ name: "x", args: {} }), reply('{"level":"L5","years":2}')]);
    expect((await chatStructured(client, request, Answer)).repaired).toBe(true);
  });
});

describe("chatStructured and stray-tail recovery", () => {
  const Wrapper = z.object({ items: z.array(Answer) });
  const glitched = '{"items": [{"level":"L5","years":7} %}'; // a complete item, then a missing bracket and junk

  it("accepts a reply with a short stray tail, makes no repair call, and says it recovered", async () => {
    const client = createMockClient([reply(glitched)]);
    const out = await chatStructured(client, request, Wrapper);
    expect(out.data.items).toEqual([{ level: "L5", years: 7 }]);
    expect(out.recovered).toBe(true);
    expect(out.repaired).toBe(false);
    expect(client.requests).toHaveLength(1);
  });

  it("reports recovered: false for a clean reply", async () => {
    const client = createMockClient([reply('{"items": []}')]);
    expect((await chatStructured(client, request, Wrapper)).recovered).toBe(false);
  });

  it("never recovers a reply the provider says was cut off by the token limit: it repairs instead", async () => {
    const client = createMockClient([
      { text: glitched, finishReason: "length" },
      reply('{"items": [{"level":"L5","years":7}]}'),
    ]);
    const out = await chatStructured(client, request, Wrapper);
    expect(out.repaired).toBe(true);
    expect(out.recovered).toBe(false);
    expect(client.requests).toHaveLength(2);
  });

  it("still validates a recovered reply against the schema, so incomplete data is rejected", async () => {
    // Recoverable syntax, but the item is missing a required field: schema validation must still fail it.
    const client = createMockClient([
      reply('{"items": [{"level":"L5"} %}'),
      reply('{"items": [{"level":"L5","years":7}]}'),
    ]);
    const out = await chatStructured(client, request, Wrapper);
    expect(out.repaired).toBe(true);
    expect(out.repairReason).toContain("years");
  });

  it("tells the model WHERE its JSON broke when it asks for a repair", async () => {
    const client = createMockClient([
      reply('{"items": [{"level": "L5" "years": 7}]}'),
      reply('{"items": []}'),
    ]);
    await chatStructured(client, request, Wrapper);
    expect(JSON.stringify(client.requests[1]?.messages.at(-1))).toMatch(
      /looks like JSON but is not valid: .* at character \d+/,
    );
  });
});

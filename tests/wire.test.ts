/** Tests for the wire format: message translation, request bodies, response parsing. */
import { describe, expect, it } from "vitest";
import { ModelProtocolError } from "../src/lib/model/errors";
import type { ChatRequest } from "../src/lib/model/types";
import { buildRequestBody, describeErrorBody, parseResponse, toWireMessages } from "../src/lib/model/wire";

const request: ChatRequest = {
  label: "test",
  target: "spark",
  messages: [{ role: "user", content: "hi" }],
};

describe("toWireMessages", () => {
  it("passes system and user string content through with their roles", () => {
    expect(
      toWireMessages([
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ]),
    ).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
  });

  it("maps a multimodal image part to the image_url wire shape", () => {
    const [message] = toWireMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "read this resume" },
          { type: "image", dataUrl: "data:image/png;base64,AAA" },
        ],
      },
    ]);
    expect(message).toEqual({
      role: "user",
      content: [
        { type: "text", text: "read this resume" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    });
  });

  it("maps assistant tool calls to tool_calls with type function", () => {
    const [message] = toWireMessages([
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "c1", name: "findTwins", arguments: '{"x":1}' }],
      },
    ]);
    expect(message).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "findTwins", arguments: '{"x":1}' } }],
    });
  });

  it("omits the tool_calls key when the assistant has no tool calls", () => {
    const [empty, missing] = toWireMessages([
      { role: "assistant", content: "done", toolCalls: [] },
      { role: "assistant", content: "done" },
    ]);
    expect(empty).toEqual({ role: "assistant", content: "done" });
    expect(empty).not.toHaveProperty("tool_calls");
    expect(missing).not.toHaveProperty("tool_calls");
  });

  it("maps a tool message's toolCallId to tool_call_id", () => {
    expect(toWireMessages([{ role: "tool", toolCallId: "c1", content: '{"n":12}' }])).toEqual([
      { role: "tool", tool_call_id: "c1", content: '{"n":12}' },
    ]);
  });
});

describe("buildRequestBody", () => {
  it("includes tools and tool_choice when tools are given", () => {
    const body = JSON.parse(
      buildRequestBody(
        {
          ...request,
          tools: [{ name: "findTwins", description: "find twins", parameters: { type: "object" } }],
          toolChoice: "auto",
        },
        "test-model",
        500,
      ),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "test-model",
      max_completion_tokens: 500,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: { name: "findTwins", description: "find twins", parameters: { type: "object" } },
        },
      ],
    });
  });

  it("omits tool_choice when tools are given but no choice is set", () => {
    const body = JSON.parse(
      buildRequestBody(
        {
          ...request,
          tools: [{ name: "findTwins", description: "find twins", parameters: { type: "object" } }],
        },
        "test-model",
        500,
      ),
    ) as Record<string, unknown>;
    expect(body).toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("omits both tools and tool_choice when no tools are given", () => {
    const body = JSON.parse(buildRequestBody(request, "test-model", 500)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("sends the caller's token budget as max_completion_tokens", () => {
    for (const budget of [200, 4000, 16000]) {
      const body = JSON.parse(buildRequestBody(request, "m", budget)) as Record<string, unknown>;
      expect(body.max_completion_tokens).toBe(budget);
    }
  });
});

describe("parseResponse", () => {
  it("parses a minimal valid body", () => {
    const parsed = parseResponse(
      JSON.stringify({
        model: "test-model",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }],
            },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      }),
    );
    expect(parsed).toEqual({
      text: "",
      toolCalls: [{ id: "c1", name: "t", arguments: "{}" }],
      finishReason: "tool_calls",
      usage: { promptTokens: 20, completionTokens: 10, reasoningTokens: 3 },
      model: "test-model",
      reasoning: undefined,
    });
  });

  it("defaults all token counts to 0 when usage is missing", () => {
    const parsed = parseResponse(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "hi" } }] }),
    );
    expect(parsed.usage).toEqual({ promptTokens: 0, completionTokens: 0, reasoningTokens: 0 });
  });

  it("turns null content into an empty string", () => {
    const parsed = parseResponse(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null } }] }),
    );
    expect(parsed.text).toBe("");
  });

  it("reports an unknown finish reason when finish_reason is missing", () => {
    const parsed = parseResponse(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
    expect(parsed.finishReason).toBe("unknown");
  });

  it("uses reasoning_content when reasoning is absent, preferring reasoning", () => {
    const fromContent = parseResponse(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "x", reasoning_content: "thoughts" } }],
      }),
    );
    expect(fromContent.reasoning).toBe("thoughts");
    const preferred = parseResponse(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "x", reasoning: "spoken", reasoning_content: "thoughts" },
          },
        ],
      }),
    );
    expect(preferred.reasoning).toBe("spoken");
  });

  it("throws ModelProtocolError for a non-JSON body", () => {
    expect(() => parseResponse("<html>gateway</html>")).toThrow(ModelProtocolError);
  });

  it("throws ModelProtocolError for an empty choices array", () => {
    expect(() => parseResponse(JSON.stringify({ choices: [] }))).toThrow(ModelProtocolError);
  });
});

describe("describeErrorBody", () => {
  it("extracts error.message from a JSON error body", () => {
    expect(describeErrorBody(JSON.stringify({ error: { message: "bad key" } }))).toBe("bad key");
  });

  it("truncates long messages to 200 characters", () => {
    expect(describeErrorBody(JSON.stringify({ error: { message: "x".repeat(300) } }))).toBe("x".repeat(200));
    expect(describeErrorBody("y".repeat(300))).toBe("y".repeat(200));
  });

  it("falls back to the raw text when the body is not a JSON error", () => {
    expect(describeErrorBody("<html>gateway</html>")).toBe("<html>gateway</html>");
    expect(describeErrorBody(JSON.stringify({ error: { message: 42 } }))).toBe(
      JSON.stringify({ error: { message: 42 } }),
    );
  });

  it("names an empty body instead of returning nothing", () => {
    expect(describeErrorBody("")).toBe("(empty body)");
  });
});

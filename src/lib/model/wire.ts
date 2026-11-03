/**
 * wire.ts: translation between our provider-independent types and the OpenAI-compatible
 * Chat Completions format spoken by the Meta Model API and Baseten.
 *
 * Responses are parsed with Zod rather than trusted: a malformed 200 should become a
 * clear ModelProtocolError, not an undefined-property crash three layers up.
 */
import { z } from "zod";
import { ModelProtocolError } from "./errors";
import type { ChatMessage, ChatRequest, ContentPart, TokenUsage, ToolCall } from "./types";

// ---------- request side ----------

type WireContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type WireMessage =
  | { role: "system" | "user"; content: string | WireContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toWirePart(part: ContentPart): WireContentPart {
  return part.type === "text"
    ? { type: "text", text: part.text }
    : { type: "image_url", image_url: { url: part.dataUrl } };
}

/** Convert our messages to the wire format. */
export function toWireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  return messages.map((message): WireMessage => {
    switch (message.role) {
      case "system":
      case "user":
        return {
          role: message.role,
          content: typeof message.content === "string" ? message.content : message.content.map(toWirePart),
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };
      case "tool":
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
  });
}

/**
 * Build the JSON request body.
 *
 * `temperature` is only included when the caller sets it: Meta recommends Muse Spark's
 * default. `reasoning_effort` is likewise omitted unless requested, leaving the
 * model's own default.
 */
export function buildRequestBody(request: ChatRequest, model: string, maxCompletionTokens: number): string {
  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(request.messages),
    max_completion_tokens: maxCompletionTokens,
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    if (request.toolChoice) body.tool_choice = request.toolChoice;
  }
  if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  return JSON.stringify(body);
}

// ---------- response side ----------

const WireResponse = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          reasoning: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).nullish(),
    })
    .nullish(),
});

/** What we extract from a successful response. */
export interface ParsedResponse {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: TokenUsage;
  model: string | undefined;
  reasoning: string | undefined;
}

/**
 * Validate and normalise a response body.
 *
 * @param text raw response body
 * @throws ModelProtocolError when the body is not JSON or lacks the expected fields
 */
export function parseResponse(text: string): ParsedResponse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ModelProtocolError("response body was not valid JSON");
  }
  const parsed = WireResponse.safeParse(json);
  if (!parsed.success) throw new ModelProtocolError(z.prettifyError(parsed.error));

  const choice = parsed.data.choices[0];
  if (!choice) throw new ModelProtocolError("response had no choices");
  const usage = parsed.data.usage;
  return {
    text: choice.message.content ?? "",
    toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    finishReason: choice.finish_reason ?? "unknown",
    usage: {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
    model: parsed.data.model,
    reasoning: choice.message.reasoning ?? choice.message.reasoning_content ?? undefined,
  };
}

/** Pull a short, safe error description out of an error response body. */
export function describeErrorBody(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: unknown } };
    const message = json.error?.message;
    if (typeof message === "string") return message.slice(0, 200);
  } catch {
    // not JSON: fall through to the raw snippet
  }
  return text.slice(0, 200) || "(empty body)";
}

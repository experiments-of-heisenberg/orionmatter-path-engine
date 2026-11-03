/**
 * toolLoop.ts: run the model with tools until it produces a final answer.
 *
 * The loop is: ask the model, run any tools it requests, give it the results, repeat.
 * Guard rails:
 *   - A cap on total tool calls (default 8). When reached, the model is told to finish and
 *     tools are switched off, so a confused model cannot loop forever or run up cost.
 *   - Bad tool arguments (invalid JSON) and tool exceptions do not crash the run: the error
 *     is fed back as the tool result so the model can correct itself. This matters because
 *     tool arguments come from an untrusted model.
 *   - Every call and result is reported through `onEvent`, which feeds the streaming trace.
 */
import type { ChatMessage, ChatRequest, ChatResult, ModelClient, ToolCall, ToolDefinition } from "./types";

/** Runs one tool. Receives parsed (but unvalidated) arguments, returns a string for the model. */
export type ToolExecutor = (call: { id: string; name: string; args: unknown }) => Promise<string> | string;

export type ToolLoopEvent =
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: string; isError: boolean }
  | { type: "limit_reached"; maxToolCalls: number };

export interface ToolLoopOptions {
  client: ModelClient;
  /** Base request. `messages` is the starting conversation. */
  request: Omit<ChatRequest, "tools" | "toolChoice"> & { tools: ToolDefinition[] };
  execute: ToolExecutor;
  /** Total tool calls allowed across the whole loop. Default 8. */
  maxToolCalls?: number;
  onEvent?: (event: ToolLoopEvent) => void;
}

export interface ToolLoopResult {
  /** The model's final (tool-free) turn. */
  final: ChatResult;
  /** Full conversation including tool calls and results. */
  messages: ChatMessage[];
  toolCallCount: number;
  /** True when the cap was reached and the model was forced to answer. */
  hitLimit: boolean;
}

/** Parse a tool call's JSON arguments. Returns the value or an error message for the model. */
function parseArguments(raw: string): { ok: true; args: unknown } | { ok: false; error: string } {
  if (raw.trim() === "") return { ok: true, args: {} };
  try {
    return { ok: true, args: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: "Tool arguments were not valid JSON. Send a single JSON object." };
  }
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const { client, execute, onEvent } = options;
  const maxToolCalls = options.maxToolCalls ?? 8;
  const messages: ChatMessage[] = [...options.request.messages];
  let toolCallCount = 0;
  let hitLimit = false;

  for (let turn = 0; ; turn++) {
    const result = await client.chat({
      ...options.request,
      label: `${options.request.label}:turn${turn + 1}`,
      messages,
      // Once the cap is hit the tools stay defined (providers expect them alongside tool
      // messages) but the model may no longer call them.
      toolChoice: hitLimit ? "none" : "auto",
    });

    if (result.toolCalls.length === 0) return { final: result, messages, toolCallCount, hitLimit };

    messages.push({ role: "assistant", content: result.text || null, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      if (toolCallCount >= maxToolCalls) {
        // Over budget: answer the call with an error so the conversation stays well-formed.
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({ error: "Tool call limit reached. Give your final answer now." }),
        });
        continue;
      }
      toolCallCount++;
      messages.push({ role: "tool", toolCallId: call.id, content: await runOne(call) });
    }

    if (toolCallCount >= maxToolCalls && !hitLimit) {
      hitLimit = true;
      onEvent?.({ type: "limit_reached", maxToolCalls });
      messages.push({
        role: "user",
        content: "You have used all available tool calls. Provide your final answer now using what you have.",
      });
    }
  }

  /** Execute one call, converting any failure into an error result for the model. */
  async function runOne(call: ToolCall): Promise<string> {
    const parsed = parseArguments(call.arguments);
    if (!parsed.ok) {
      const result = JSON.stringify({ error: parsed.error });
      onEvent?.({ type: "tool_call", id: call.id, name: call.name, args: call.arguments });
      onEvent?.({ type: "tool_result", id: call.id, name: call.name, result, isError: true });
      return result;
    }
    onEvent?.({ type: "tool_call", id: call.id, name: call.name, args: parsed.args });
    try {
      const result = await execute({ id: call.id, name: call.name, args: parsed.args });
      onEvent?.({ type: "tool_result", id: call.id, name: call.name, result, isError: false });
      return result;
    } catch (error) {
      const result = JSON.stringify({ error: error instanceof Error ? error.message : "tool failed" });
      onEvent?.({ type: "tool_result", id: call.id, name: call.name, result, isError: true });
      return result;
    }
  }
}

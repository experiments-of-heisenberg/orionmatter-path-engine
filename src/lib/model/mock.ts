/**
 * mock.ts: a scriptable fake model client for tests.
 *
 * Agents depend only on the ModelClient interface, so their logic (what they ask, how they
 * react to a bad reply, when they call tools) can be tested deterministically and for free.
 * Each call consumes the next scripted step, and every request is recorded for assertions.
 */
import type { ChatRequest, ChatResult, ModelClient, ToolCall } from "./types";

/** The content of one scripted reply. Anything omitted gets a sensible default. */
export type MockReply = Partial<Pick<ChatResult, "text" | "toolCalls" | "finishReason" | "usage">>;

/** A scripted reply, or a function that builds one from the incoming request. */
export type MockStep = MockReply | ((request: ChatRequest) => MockReply);

export interface MockModelClient extends ModelClient {
  /** Every request received, in order. */
  readonly requests: ChatRequest[];
  /** Steps not yet consumed. */
  readonly remaining: number;
}

/** Script a plain text reply. */
export const reply = (text: string): MockReply => ({ text, finishReason: "stop" });

/** Script a reply that asks for tool calls. */
export const callTools = (...calls: { name: string; args: unknown; id?: string }[]): MockReply => ({
  text: "",
  finishReason: "tool_calls",
  toolCalls: calls.map((call, index): ToolCall => ({
    id: call.id ?? `call_${index + 1}`,
    name: call.name,
    arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
  })),
});

/**
 * @param script steps to play back, one per `chat` call
 * @throws from `chat` when the script is exhausted, so a test notices an unexpected extra call
 */
export function createMockClient(script: MockStep[]): MockModelClient {
  const queue = [...script];
  const requests: ChatRequest[] = [];

  return {
    requests,
    get remaining() {
      return queue.length;
    },
    chat(request: ChatRequest): Promise<ChatResult> {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) {
        return Promise.reject(
          new Error(`MockModelClient: script exhausted at call ${requests.length} ("${request.label}")`),
        );
      }
      const step = typeof next === "function" ? next(request) : next;
      return Promise.resolve({
        text: step.text ?? "",
        toolCalls: step.toolCalls ?? [],
        finishReason: step.finishReason ?? "stop",
        usage: step.usage ?? { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
        model: "mock",
        attempts: 1,
        latencyMs: 0,
        fromFixture: false,
      });
    },
  };
}

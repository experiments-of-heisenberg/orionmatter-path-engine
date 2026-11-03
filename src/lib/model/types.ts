/**
 * types.ts: the vocabulary of the model client.
 *
 * These types are deliberately independent of any provider's wire format. Agents are
 * written against them; the client translates to and from the OpenAI-compatible
 * Chat Completions format that both the Meta Model API and Baseten speak.
 */

/** Which model an agent wants: Muse Spark (Meta API) or Muse Spark Open (open weights on Baseten). */
export type ModelTarget = "spark" | "open";

/**
 * How much the model thinks before answering. Lower is faster and cheaper.
 * Muse Spark rejects "none", so it is not offered. See docs/api-notes.md.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** One part of a multimodal user message. */
export type ContentPart = { type: "text"; text: string } | { type: "image"; dataUrl: string };

/** A tool invocation requested by the model. `arguments` is the raw JSON string, deliberately unparsed. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A message in a conversation. */
export type ChatMessage =
  | { role: "system" | "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A request for one model turn. */
export interface ChatRequest {
  /** Human-readable name of the caller, e.g. "planner:round1". Used in logs and fixture files, never sent to the model. */
  label: string;
  target: ModelTarget;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  reasoningEffort?: ReasoningEffort;
  /**
   * Cap on generated tokens INCLUDING hidden reasoning tokens (Muse Spark counts both).
   * If the whole budget is consumed by reasoning, the client retries with a larger one.
   */
  maxCompletionTokens?: number;
  /** Leave unset for Muse Spark: Meta recommends its default of 1.0. */
  temperature?: number;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
  /** Cancels the request (for example when a streaming client disconnects). */
  signal?: AbortSignal;
}

/** Token accounting for one call. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** Subset of completionTokens spent on hidden reasoning. */
  reasoningTokens: number;
}

/** The outcome of one model turn. */
export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  /** "stop", "tool_calls", "length", ... as reported by the provider. */
  finishReason: string;
  usage: TokenUsage;
  /** Model id that actually served the request. */
  model: string;
  /** Visible reasoning text when the provider exposes it (Muse Spark Open does). */
  reasoning?: string;
  /** HTTP attempts used, including retries and token-budget escalations. 0 when replayed from a fixture. */
  attempts: number;
  latencyMs: number;
  /** True when the result was replayed from a recorded fixture instead of a live call. */
  fromFixture: boolean;
}

/** The one interface agents depend on. Real, mock and replaying clients all implement it. */
export interface ModelClient {
  chat(request: ChatRequest): Promise<ChatResult>;
}

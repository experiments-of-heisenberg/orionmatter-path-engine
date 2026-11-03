/**
 * chatProbe.ts: typed helpers shared by the live-API diagnostic scripts.
 *
 * Both smoke-models.ts and probe-vision.ts call the same OpenAI-compatible
 * /chat/completions endpoint and read the same few response fields. Keeping that in
 * one typed place avoids duplicated fetch code and untyped `any` access.
 */

/** A model endpoint we can probe. */
export interface Target {
  name: "spark";
  baseUrl: string;
  key: string;
  model: string;
}

/** The subset of a chat completion message we read. */
export interface ChatMessage {
  content?: string | null;
  tool_calls?: unknown[];
  reasoning?: string;
  reasoning_content?: string;
}

/** The subset of a chat completion response we read. */
export interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
}

/** Result of one HTTP call: status, parsed body (if JSON), and a raw snippet for errors. */
export interface ChatResult {
  status: number;
  json: ChatResponse | null;
  raw: string;
}

/** The model target, reading the key from the environment (never printed). */
export function loadTargets(): Target[] {
  return [
    {
      name: "spark",
      baseUrl: "https://api.meta.ai/v1",
      key: process.env.MODEL_API_KEY ?? "",
      model: process.env.META_MODEL_SPARK ?? "muse-spark-1.3",
    },
  ];
}

/** POST a chat completion with a 60 s timeout. Never throws on HTTP errors. */
export async function postChat(target: Target, body: Record<string, unknown>): Promise<ChatResult> {
  const response = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: target.model, ...body }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json: ChatResponse | null = null;
  try {
    json = JSON.parse(text) as ChatResponse;
  } catch {
    // Non-JSON body (e.g. a gateway error page): keep only the raw snippet.
  }
  return { status: response.status, json, raw: text.slice(0, 300) };
}

/** The first choice's message, if any. */
export const messageOf = (result: ChatResult): ChatMessage | undefined => result.json?.choices?.[0]?.message;

/** The reply text, or an empty string. */
export const textOf = (result: ChatResult): string => messageOf(result)?.content ?? "";

/** True when the reply carries non-empty text (an empty reply means the token budget was eaten by reasoning). */
export const hasText = (result: ChatResult): boolean => textOf(result).trim().length > 0;

/** Reasoning tokens reported in usage, useful for sizing token budgets. */
export const reasoningTokens = (result: ChatResult): number | "n/a" =>
  result.json?.usage?.completion_tokens_details?.reasoning_tokens ?? "n/a";

/** Collapse whitespace and truncate, for compact single-line report output. */
export const brief = (text: string, max = 80): string => text.replace(/\s+/g, " ").trim().slice(0, max);

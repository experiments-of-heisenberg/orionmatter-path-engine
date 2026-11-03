/**
 * Test helpers for the model client: a scripted fake HTTP transport and builders for
 * provider-shaped response bodies. No network is ever touched.
 */
import { parseEnv } from "../../src/lib/env";
import type { HttpTransport, TransportRequest, TransportResponse } from "../../src/lib/model/transport";

/** A step is either a response to return or an error to throw. */
export type TransportStep = TransportResponse | Error;

export interface FakeTransport extends HttpTransport {
  /** Every request received, in order. */
  readonly requests: TransportRequest[];
}

/** Play back steps in order; running out is a test bug and fails loudly. */
export function scriptedTransport(steps: TransportStep[]): FakeTransport {
  const queue = [...steps];
  const requests: TransportRequest[] = [];
  return {
    requests,
    post(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) return Promise.reject(new Error("fake transport: script exhausted"));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

interface BodyOptions {
  content?: string | null;
  toolCalls?: { id: string; name: string; arguments: string }[];
  finish?: string;
  reasoningTokens?: number;
  completionTokens?: number;
  reasoning?: string;
}

/** A well-formed 200 response in the OpenAI-compatible shape. */
export function okResponse(options: BodyOptions = {}): TransportResponse {
  const {
    content = "hello",
    toolCalls,
    finish = "stop",
    reasoningTokens = 3,
    completionTokens = 10,
    reasoning,
  } = options;
  const body = {
    model: "test-model",
    choices: [
      {
        finish_reason: finish,
        message: {
          content,
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls
            ? {
                tool_calls: toolCalls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: completionTokens,
      completion_tokens_details: { reasoning_tokens: reasoningTokens },
    },
  };
  return { status: 200, text: JSON.stringify(body), retryAfter: null };
}

/** An error response such as 429 or 500, optionally with a Retry-After header. */
export function errorResponse(
  status: number,
  message = "boom",
  retryAfter: string | null = null,
): TransportResponse {
  return { status, text: JSON.stringify({ error: { message } }), retryAfter };
}

/** Valid environment for live-mode tests. Values are deliberately short fakes. */
export const testEnv = parseEnv({ MODEL_API_KEY: "test-meta-key", BASETEN_API_KEY: "test-baseten-key" });

/** A sleep that records requested delays and returns immediately. */
export function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: (ms: number) => (delays.push(ms), Promise.resolve()) };
}

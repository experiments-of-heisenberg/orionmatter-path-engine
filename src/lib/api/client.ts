/**
 * client.ts: how the browser calls the API.
 *
 * `postJson` for the instant routes, `streamPost` for the streaming ones. Both turn every failure
 * (an HTTP error, an `error` event, a dropped connection) into one `ApiClientError` with a stable
 * code, so the interface has a single place to decide what to show. The `fetch` is injectable so the
 * same code is tested without a network.
 */
import type { AgentEvent } from "../agents";
import { isApiErrorBody, parseSse } from "./sseClient";
import type { ApiErrorBody, ApiErrorCode } from "./errors";

/** Codes the client adds on top of the server's own. */
export type ClientErrorCode = ApiErrorCode | "network" | "stream_ended" | "bad_response";

export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number | undefined;
  readonly retryAfter: number | undefined;
  readonly issues: ApiErrorBody["issues"];

  constructor(
    code: ClientErrorCode,
    message: string,
    extra: { status?: number; retryAfter?: number; issues?: ApiErrorBody["issues"] } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = extra.status;
    this.retryAfter = extra.retryAfter;
    this.issues = extra.issues;
  }

  /** True when trying again later is a sensible response. */
  get retryable(): boolean {
    return (
      this.code === "rate_limited" ||
      this.code === "busy" ||
      this.code === "model_unavailable" ||
      this.code === "model_unreadable" ||
      this.code === "network"
    );
  }
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Replace `fetch`, for tests. */
  fetch?: typeof fetch;
}

export interface StreamOptions extends CallOptions {
  /** Called for each progress event, in order. Not called for `open`, `result` or `error`. */
  onEvent?: (event: StreamEvent) => void;
}

/** A progress event from a streaming route. */
export type StreamEvent =
  { kind: "agent"; event: AgentEvent } | { kind: "other"; name: string; data: unknown };

const AGENT_EVENTS = new Set(["stage", "tool_call", "tool_result", "note", "verdict"]);

/** True for the error a cancelled fetch throws: a DOMException in browsers, a plain Error with the same name elsewhere. */
function isAbort(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException) && error.name === "AbortError";
}

/** Build an ApiClientError from a response that was not OK. */
async function failureFrom(response: Response): Promise<ApiClientError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // not JSON (a proxy error page): fall through to a generic message
  }
  if (isApiErrorBody(body)) {
    return new ApiClientError(body.code, body.message, {
      status: response.status,
      ...(body.retryAfter !== undefined ? { retryAfter: body.retryAfter } : {}),
      ...(body.issues ? { issues: body.issues } : {}),
    });
  }
  return new ApiClientError("bad_response", `The server answered ${response.status}.`, {
    status: response.status,
  });
}

async function send(url: string, body: unknown, options: CallOptions): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  try {
    return await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiClientError("network", "Could not reach the server. Check your connection and try again.");
  }
}

/** POST JSON and read one JSON answer. */
export async function postJson<T>(url: string, body: unknown, options: CallOptions = {}): Promise<T> {
  const response = await send(url, body, options);
  if (!response.ok) throw await failureFrom(response);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiClientError("bad_response", "The server's answer could not be read.", {
      status: response.status,
    });
  }
}

/** POST JSON and read an event stream: progress to `onEvent`, then resolve with the `result`. */
export async function streamPost<T>(url: string, body: unknown, options: StreamOptions = {}): Promise<T> {
  const response = await send(url, body, options);
  if (!response.ok) throw await failureFrom(response);
  if (!response.body)
    throw new ApiClientError("bad_response", "The server sent no data.", { status: response.status });
  try {
    for await (const { event, data } of parseSse(response.body)) {
      if (event === "result") return data as T;
      if (event === "error") {
        if (isApiErrorBody(data))
          throw new ApiClientError(data.code, data.message, {
            ...(data.retryAfter !== undefined ? { retryAfter: data.retryAfter } : {}),
            ...(data.issues ? { issues: data.issues } : {}),
          });
        throw new ApiClientError("bad_response", "The server reported an error.");
      }
      if (event === "open") continue;
      options.onEvent?.(
        AGENT_EVENTS.has(event)
          ? { kind: "agent", event: data as AgentEvent }
          : { kind: "other", name: event, data },
      );
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (isAbort(error)) throw error;
    throw new ApiClientError("network", "The connection was interrupted. Please try again.");
  }
  throw new ApiClientError(
    "stream_ended",
    "The connection closed before the answer arrived. Please try again.",
  );
}

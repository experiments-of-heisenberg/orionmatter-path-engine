/**
 * sse.ts: Server-Sent Events, both directions.
 *
 * SERVER: `sseResponse` turns a long agent run into an event stream: progress events as they
 * happen, then exactly one `result` or `error` event, then the stream closes. A heartbeat comment
 * keeps proxies from closing an idle connection while the model thinks. If the browser goes away,
 * the next event the run tries to send throws, which stops the run instead of letting it spend
 * model calls for nobody.
 *
 * CLIENT: `parseSse` turns a response body back into events (used by the browser and by tests).
 */
import type { AgentEvent, Emit } from "../agents";
import { ClientClosedError, toApiError, type ApiErrorBody } from "./errors";

/** How often a comment line is sent to keep the connection alive, in milliseconds. */
export const HEARTBEAT_MS = 15_000;

/** The headers every event stream carries. */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // tell nginx-style proxies not to buffer the stream
};

/** What a run can do while it works. */
export interface SseContext {
  /** Report agent progress; throws ClientClosedError once the browser has gone. */
  emit: Emit;
  /** Send a named event of your own. */
  send: (event: string, data: unknown) => void;
}

export interface SseOptions {
  requestId: string;
  signal: AbortSignal;
  headers?: Record<string, string>;
  heartbeatMs?: number;
  /** Called with whatever ended the run, for logging (never sent to the browser as text). */
  onFinish?: (outcome: { ok: true } | { ok: false; error: unknown; closedByClient: boolean }) => void;
}

/**
 * Run `work` and stream its progress.
 *
 * The stream always ends with `result` (the value `work` returned) or `error` (an ApiErrorBody).
 */
export function sseResponse(work: (ctx: SseContext) => Promise<unknown>, options: SseOptions): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let onAbort: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // the consumer is gone
        }
      };
      const send = (event: string, data: unknown): void => {
        if (closed) throw new ClientClosedError();
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const emit: Emit = (event: AgentEvent) => send(event.type, event);

      onAbort = () => {
        closed = true;
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
      heartbeat = setInterval(() => write(": ping\n\n"), options.heartbeatMs ?? HEARTBEAT_MS);

      try {
        send("open", { requestId: options.requestId });
        const result = await work({ emit, send });
        const wasClosed = closed;
        if (!wasClosed) send("result", result);
        options.onFinish?.({ ok: true });
      } catch (error) {
        const apiError = toApiError(error);
        const closedByClient = apiError.code === "client_closed" || closed;
        if (!closedByClient) write(`event: error\ndata: ${JSON.stringify(apiError.toBody())}\n\n`);
        options.onFinish?.({ ok: false, error, closedByClient });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (onAbort) options.signal.removeEventListener("abort", onAbort);
        closed = true;
        // Always close: if the consumer already left, close() throws and that is fine; if it is still
        // reading (an aborted signal does not mean the reader is gone), it must see the end of the stream.
        try {
          controller.close();
        } catch {
          // already closed or cancelled by the consumer
        }
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS, ...options.headers } });
}

/** One event read from a stream. */
export interface SseEvent {
  event: string;
  data: unknown;
}

/** Longest single event accepted by the parser, in characters. */
const MAX_EVENT_CHARS = 5_000_000;

/**
 * Read an event stream from a fetch response body.
 *
 * Handles events split across chunks, CRLF line endings and comment lines; ignores anything that is
 * not valid JSON data rather than throwing, since a half event at a dropped connection is normal.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      if (buffer.length > MAX_EVENT_CHARS) throw new Error("SSE event too large");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment (heartbeat)
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return undefined;
  try {
    return { event, data: JSON.parse(data.join("\n")) as unknown };
  } catch {
    return undefined;
  }
}

/** True for the body of an `error` event. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

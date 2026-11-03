/**
 * sse.ts: Server-Sent Events, both directions.
 *
 * SERVER: `sseResponse` turns a long agent run into an event stream: progress events as they
 * happen, then exactly one `result` or `error` event, then the stream closes. A heartbeat comment
 * keeps proxies from closing an idle connection while the model thinks. If the browser goes away,
 * the next event the run tries to send throws, which stops the run instead of letting it spend
 * model calls for nobody.
 *
 * CLIENT: `parseSse` (in sseClient.ts, re-exported here) turns a response body back into events.
 */
import type { AgentEvent, Emit } from "../agents";
import { ClientClosedError, toApiError } from "./errors";

// The client half lives in sseClient.ts so the browser bundle never reaches server-only code.
export { isApiErrorBody, parseSse, type SseEvent } from "./sseClient";

/** How often a comment line is sent to keep the connection alive, in milliseconds. */
export const HEARTBEAT_MS = 15_000;

/**
 * Most unread chunks a stream may hold before the reader is considered gone. A run emits a few dozen
 * events and a heartbeat every 15 s, so hitting this means a connected consumer that never reads.
 */
export const MAX_PENDING_CHUNKS = 500;

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
        if (controller.desiredSize !== null && controller.desiredSize < -MAX_PENDING_CHUNKS) {
          closed = true; // a consumer that never reads must not make the server buffer without limit
          return;
        }
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

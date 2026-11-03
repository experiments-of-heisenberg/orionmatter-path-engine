/**
 * sseClient.ts: read an event stream in the browser (or in tests).
 *
 * Deliberately free of server imports: this file and client.ts are bundled for the browser, so they
 * must not reach anything that needs Node (the model fixtures, the evidence ledger, `node:crypto`).
 * A test bundles client.ts for the browser platform to keep that true.
 */
import type { ApiErrorBody } from "./errors";

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

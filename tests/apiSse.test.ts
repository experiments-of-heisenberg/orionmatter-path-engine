/** Tests for Server-Sent Events: the server stream and the client parser, including disconnects. */
import { describe, expect, it } from "vitest";
import { ClientClosedError } from "../src/lib/api/errors";
import { HEARTBEAT_MS, parseSse, sseResponse, SSE_HEADERS, type SseEvent } from "../src/lib/api/sse";
import { ModelHttpError } from "../src/lib/model";
import { readEvents } from "./helpers/api";

const noAbort = new AbortController().signal;

/** A body that delivers the given chunks one at a time. */
function bodyOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of parseSse(body)) events.push(event);
  return events;
}

describe("sseResponse", () => {
  it("streams open, progress events, then exactly one result, and closes", async () => {
    const response = sseResponse(
      ({ emit, send }) => {
        emit({ type: "stage", stage: "gathering" });
        emit({ type: "note", message: "hello" });
        send("custom", { a: 1 });
        return Promise.resolve({ answer: 42 });
      },
      { requestId: "r1", signal: noAbort },
    );
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(SSE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["open", "stage", "note", "custom", "result"]);
    expect(events[0]?.data).toEqual({ requestId: "r1" });
    expect(events[1]?.data).toEqual({ type: "stage", stage: "gathering" });
    expect(events.at(-1)?.data).toEqual({ answer: 42 });
  });

  it("ends with a typed error event when the work fails, and never with a result", async () => {
    const outcomes: unknown[] = [];
    const response = sseResponse(
      () => Promise.reject(new ModelHttpError(503, "secret upstream text", 3000)),
      {
        requestId: "r2",
        signal: noAbort,
        onFinish: (o) => outcomes.push(o),
      },
    );
    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["open", "error"]);
    expect(events[1]?.data).toEqual({
      code: "model_unavailable",
      message: "The model is busy or unreachable. Please try again shortly.",
      retryAfter: 3,
    });
    expect(JSON.stringify(events)).not.toContain("secret upstream text");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ ok: false, closedByClient: false });
  });

  it("an unknown error becomes a generic internal error event", async () => {
    const events = await readEvents(
      sseResponse(() => Promise.reject(new Error("db password hunter2")), {
        requestId: "r",
        signal: noAbort,
      }),
    );
    expect(events.at(-1)).toEqual({
      event: "error",
      data: { code: "internal", message: "Something went wrong on our side." },
    });
    expect(JSON.stringify(events)).not.toContain("hunter2");
  });

  it("calls onFinish exactly once for success", async () => {
    const outcomes: unknown[] = [];
    await readEvents(
      sseResponse(() => Promise.resolve(1), {
        requestId: "r",
        signal: noAbort,
        onFinish: (o) => outcomes.push(o),
      }),
    );
    expect(outcomes).toEqual([{ ok: true }]);
  });

  it("stops a run early when the client disconnects: the next emit throws and no result is sent", async () => {
    const controller = new AbortController();
    const outcomes: { ok: boolean; closedByClient?: boolean }[] = [];
    let stepsRun = 0;
    const response = sseResponse(
      ({ emit }) => {
        emit({ type: "note", message: "one" });
        stepsRun++;
        controller.abort(); // the browser goes away mid-run
        emit({ type: "note", message: "two" }); // must throw
        stepsRun++;
        return Promise.resolve("never sent");
      },
      { requestId: "r", signal: controller.signal, onFinish: (o) => outcomes.push(o) },
    );
    const events = await readEvents(response);
    expect(stepsRun).toBe(1);
    expect(events.map((e) => e.event)).not.toContain("result");
    expect(events.map((e) => e.event)).not.toContain("error");
    expect(outcomes).toEqual([expect.objectContaining({ ok: false, closedByClient: true })]);
  });

  it("an already-aborted request still finishes cleanly and calls onFinish (no leaked slot)", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcomes: unknown[] = [];
    let ran = false;
    const response = sseResponse(
      () => {
        ran = true;
        return Promise.resolve(1);
      },
      { requestId: "r", signal: controller.signal, onFinish: (o) => outcomes.push(o) },
    );
    await readEvents(response);
    expect(ran).toBe(false); // the 'open' event threw before the work started
    expect(outcomes).toHaveLength(1);
  });

  it("cancelling the stream (the reader leaves) stops the run and calls onFinish", async () => {
    const outcomes: unknown[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const response = sseResponse(
      async ({ emit }) => {
        await gate;
        emit({ type: "note", message: "late" });
        return 1;
      },
      { requestId: "r", signal: noAbort, onFinish: (o) => outcomes.push(o) },
    );
    const reader = response.body!.getReader();
    await reader.read(); // the open event
    await reader.cancel();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcomes).toEqual([expect.objectContaining({ ok: false, closedByClient: true })]);
  });

  it("sends heartbeat comments while the work is slow", async () => {
    const response = sseResponse(() => new Promise((resolve) => setTimeout(() => resolve("done"), 60)), {
      requestId: "r",
      signal: noAbort,
      heartbeatMs: 10,
    });
    const text = await response.text();
    expect((text.match(/: ping/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(text).toContain("event: result");
    expect(HEARTBEAT_MS).toBe(15_000);
  });

  it("keeps data on one line, so embedded newlines in text cannot forge an event", async () => {
    const events = await readEvents(
      sseResponse(() => Promise.resolve({ text: 'line one\n\nevent: result\ndata: {"forged":true}' }), {
        requestId: "r",
        signal: noAbort,
      }),
    );
    expect(events.map((e) => e.event)).toEqual(["open", "result"]);
    expect(events[1]?.data).toEqual({ text: 'line one\n\nevent: result\ndata: {"forged":true}' });
  });

  it("ClientClosedError is what a closed stream throws", () => {
    expect(new ClientClosedError().name).toBe("ClientClosedError");
  });
});

describe("parseSse", () => {
  it("reads events split across chunks at any position", async () => {
    const text = 'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n';
    for (let cut = 1; cut < text.length; cut += 7) {
      const events = await collect(bodyOf(text.slice(0, cut), text.slice(cut)));
      expect(events).toEqual([
        { event: "a", data: { x: 1 } },
        { event: "b", data: { y: 2 } },
      ]);
    }
  });

  it("handles CRLF line endings, comments, and a default event name", async () => {
    const events = await collect(bodyOf(': ping\r\n\r\ndata: {"z":3}\r\n\r\nevent: c\r\ndata: 5\r\n\r\n'));
    expect(events).toEqual([
      { event: "message", data: { z: 3 } },
      { event: "c", data: 5 },
    ]);
  });

  it("joins multi-line data and ignores blocks that are not valid JSON or have no data", async () => {
    const events = await collect(
      bodyOf('data: {"a":\ndata: 1}\n\nevent: broken\ndata: {nope\n\nevent: empty\n\ndata: 7\n\n'),
    );
    expect(events).toEqual([
      { event: "message", data: { a: 1 } },
      { event: "message", data: 7 },
    ]);
  });

  it("drops a final event that never finished, as happens when a connection drops", async () => {
    expect(await collect(bodyOf('event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y"'))).toEqual([
      { event: "a", data: { x: 1 } },
    ]);
  });

  it("handles multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"t":"héllo ✓"}\n\n');
    const split = 14; // inside a multi-byte sequence
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, split));
        c.enqueue(bytes.slice(split));
        c.close();
      },
    });
    expect(await collect(body)).toEqual([{ event: "message", data: { t: "héllo ✓" } }]);
  });

  it("refuses an event larger than the cap instead of buffering forever", async () => {
    const huge = `data: ${"x".repeat(5_100_000)}`;
    await expect(collect(bodyOf(huge))).rejects.toThrow("SSE event too large");
  });
});

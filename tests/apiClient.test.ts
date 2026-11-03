/** Tests for the browser-side API client: JSON and streaming calls, and one error type for every failure. */
import { describe, expect, it } from "vitest";
import { ApiClientError, postJson, streamPost, type StreamEvent } from "../src/lib/api/client";
import { sseResponse } from "../src/lib/api/sse";
import { ModelHttpError } from "../src/lib/model";

const noAbort = new AbortController().signal;
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchOf =
  (response: Response | (() => Promise<Response>)): typeof fetch =>
  () =>
    typeof response === "function" ? response() : Promise.resolve(response);

async function failure<T>(promise: Promise<T>): Promise<ApiClientError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiClientError;
  }
  throw new Error("expected a failure");
}

describe("postJson", () => {
  it("sends JSON and returns the parsed answer", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = ((url: string, init: RequestInit) => {
      seen = { url, init };
      return Promise.resolve(jsonResponse({ ok: 1 }));
    }) as unknown as typeof fetch;
    expect(await postJson("/api/x", { a: 1 }, { fetch: fake })).toEqual({ ok: 1 });
    expect(seen?.url).toBe("/api/x");
    expect(seen?.init.method).toBe("POST");
    expect((seen?.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(seen?.init.body).toBe('{"a":1}');
  });

  it("turns an API error body into an ApiClientError with its code, status, retry hint and issues", async () => {
    const error = await failure(
      postJson(
        "/x",
        {},
        { fetch: fetchOf(jsonResponse({ code: "rate_limited", message: "Slow down", retryAfter: 9 }, 429)) },
      ),
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "rate_limited",
      message: "Slow down",
      status: 429,
      retryAfter: 9,
      retryable: true,
    });
    const invalid = await failure(
      postJson(
        "/x",
        {},
        {
          fetch: fetchOf(
            jsonResponse(
              { code: "invalid_request", message: "bad", issues: [{ path: "a", message: "m" }] },
              400,
            ),
          ),
        },
      ),
    );
    expect(invalid).toMatchObject({
      code: "invalid_request",
      retryable: false,
      issues: [{ path: "a", message: "m" }],
    });
  });

  it("copes with a non-JSON error page and with a malformed success body", async () => {
    const html = await failure(
      postJson("/x", {}, { fetch: fetchOf(new Response("<html>502</html>", { status: 502 })) }),
    );
    expect(html).toMatchObject({ code: "bad_response", status: 502, message: "The server answered 502." });
    const broken = await failure(
      postJson("/x", {}, { fetch: fetchOf(new Response("not json", { status: 200 })) }),
    );
    expect(broken.code).toBe("bad_response");
  });

  it("reports a network failure as a retryable 'network' error", async () => {
    const error = await failure(
      postJson("/x", {}, { fetch: fetchOf(() => Promise.reject(new TypeError("fetch failed"))) }),
    );
    expect(error).toMatchObject({ code: "network", retryable: true });
  });

  it("lets an abort through unchanged, so callers can tell cancel from failure", async () => {
    const abort = () => Promise.reject(new DOMException("aborted", "AbortError"));
    await expect(postJson("/x", {}, { fetch: fetchOf(abort) })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("streamPost", () => {
  it("passes progress events in order, then resolves with the result", async () => {
    const response = sseResponse(
      ({ emit, send }) => {
        emit({ type: "stage", stage: "gathering" });
        send("custom", { n: 1 });
        emit({ type: "note", message: "hi" });
        return Promise.resolve({ done: true });
      },
      { requestId: "r", signal: noAbort },
    );
    const seen: StreamEvent[] = [];
    const result = await streamPost<{ done: boolean }>(
      "/x",
      {},
      { fetch: fetchOf(response), onEvent: (e) => seen.push(e) },
    );
    expect(result).toEqual({ done: true });
    expect(seen).toEqual([
      { kind: "agent", event: { type: "stage", stage: "gathering" } },
      { kind: "other", name: "custom", data: { n: 1 } },
      { kind: "agent", event: { type: "note", message: "hi" } },
    ]);
  });

  it("throws the stream's error event as an ApiClientError", async () => {
    const response = sseResponse(() => Promise.reject(new ModelHttpError(503, "x", 4000)), {
      requestId: "r",
      signal: noAbort,
    });
    const error = await failure(streamPost("/x", {}, { fetch: fetchOf(response) }));
    expect(error).toMatchObject({ code: "model_unavailable", retryAfter: 4, retryable: true });
  });

  it("throws an HTTP-level error (a guard refused before streaming) with its code", async () => {
    const error = await failure(
      streamPost(
        "/x",
        {},
        { fetch: fetchOf(jsonResponse({ code: "payload_too_large", message: "big" }, 413)) },
      ),
    );
    expect(error).toMatchObject({ code: "payload_too_large", status: 413, retryable: false });
  });

  it("reports a stream that ends with no result as 'stream_ended'", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            'event: open\ndata: {"requestId":"r"}\n\nevent: stage\ndata: {"type":"stage","stage":"gathering"}\n\n',
          ),
        );
        c.close();
      },
    });
    const error = await failure(
      streamPost(
        "/x",
        {},
        { fetch: fetchOf(new Response(body, { headers: { "content-type": "text/event-stream" } })) },
      ),
    );
    expect(error.code).toBe("stream_ended");
  });

  it("reports a connection that breaks mid-stream as a retryable network error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: open\ndata: {"requestId":"r"}\n\n'));
        c.error(new TypeError("terminated"));
      },
    });
    const error = await failure(streamPost("/x", {}, { fetch: fetchOf(new Response(body)) }));
    expect(error).toMatchObject({ code: "network", retryable: true });
  });

  it("does not report 'open' as a progress event", async () => {
    const response = sseResponse(() => Promise.resolve(1), { requestId: "r", signal: noAbort });
    const seen: StreamEvent[] = [];
    await streamPost("/x", {}, { fetch: fetchOf(response), onEvent: (e) => seen.push(e) });
    expect(seen).toEqual([]);
  });
});

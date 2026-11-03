/** Regression tests for the Part 11 review findings (a bug and several doubts from Muse Code's bug hunt, each confirmed by a probe). */
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { ApiClientError, postJson, streamPost } from "../src/lib/api/client";
import { toApiError } from "../src/lib/api/errors";
import { MAX_PENDING_CHUNKS, sseResponse } from "../src/lib/api/sse";
import { ModelEmptyResponseError, ModelProtocolError } from "../src/lib/model";
import { Constraints, Goal, MAX_SKILLS, Profile } from "../src/lib/schemas";
import { MAX_SKILLS as WHATIF_MAX_SKILLS } from "../src/lib/whatif";

describe("the browser client bundles for the browser (review finding)", () => {
  it("reaches no Node-only module: client.ts builds with platform 'browser'", async () => {
    const result = await build({
      entryPoints: ["src/lib/api/client.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      logLevel: "silent",
    });
    expect(result.errors).toEqual([]);
    const code = result.outputFiles[0]?.text ?? "";
    expect(code).not.toMatch(/node:(crypto|fs|path)/);
    expect(code.length).toBeLessThan(50_000); // a client, not the server in disguise
  });

  it("the server-side SSE module still exports the client half for existing callers", async () => {
    const sse = await import("../src/lib/api/sse");
    expect(typeof sse.parseSse).toBe("function");
    expect(typeof sse.isApiErrorBody).toBe("function");
  });
});

describe("abort handling works across runtimes (review finding)", () => {
  const abortLike = () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  const fetchOf = (fn: () => Promise<Response>): typeof fetch => fn;

  it("a plain Error named AbortError is rethrown, not reported as a network failure", async () => {
    await expect(postJson("/x", {}, { fetch: fetchOf(abortLike) })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(streamPost("/x", {}, { fetch: fetchOf(abortLike) })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("an abort during a stream is rethrown too, and other errors are still 'network'", async () => {
    const body = (error: Error) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.error(error);
          },
        }),
      );
    await expect(
      streamPost(
        "/x",
        {},
        {
          fetch: fetchOf(() => Promise.resolve(body(Object.assign(new Error("a"), { name: "AbortError" })))),
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      streamPost("/x", {}, { fetch: fetchOf(() => Promise.resolve(body(new TypeError("terminated")))) }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("limits at the door match the agents' own limits (review finding)", () => {
  it("Constraints enforces the same skill limit as the What-if interpreter, from one definition", () => {
    expect(MAX_SKILLS).toBe(5);
    expect(WHATIF_MAX_SKILLS).toBe(MAX_SKILLS);
  });

  it("Goal and Profile fields have sensible length caps", () => {
    expect(Goal.safeParse({ targetLevel: "L6", label: "x".repeat(60) }).success).toBe(true);
    expect(Goal.safeParse({ targetLevel: "L6", label: "x".repeat(61) }).success).toBe(false);
    expect(Goal.safeParse({ targetLevel: "x".repeat(11), label: "a" }).success).toBe(false);
    const base = {
      roleFamily: "backend",
      level: "L5",
      yearsExperience: 5,
      stack: ["go"],
      region: "IN-south",
    };
    expect(Profile.safeParse(base).success).toBe(true);
    expect(Profile.safeParse({ ...base, level: "x".repeat(11) }).success).toBe(false);
    expect(Profile.safeParse({ ...base, region: "x".repeat(21) }).success).toBe(false);
    expect(Profile.safeParse({ ...base, stack: ["x".repeat(41)] }).success).toBe(false);
    expect(Profile.safeParse({ ...base, compBand: "B3333" }).success).toBe(false);
    expect(Constraints.safeParse({ addSkills: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
  });
});

describe("more model failures map to a retryable code (review finding)", () => {
  it("a protocol error and an empty reply are 'model_unreadable' (502), not an internal error", () => {
    for (const error of [new ModelProtocolError("shape"), new ModelEmptyResponseError("length", 200)]) {
      expect(toApiError(error)).toMatchObject({ code: "model_unreadable", status: 502, retryAfter: 2 });
    }
  });
});

describe("a consumer that never reads cannot make the server buffer without limit (review finding)", () => {
  it("stops the run once too many chunks are unread, and reports it as closed by the client", async () => {
    const outcomes: { ok: boolean; closedByClient?: boolean }[] = [];
    let emitted = 0;
    const response = sseResponse(
      ({ emit }) => {
        for (let i = 0; i < MAX_PENDING_CHUNKS * 3; i++) {
          emit({ type: "note", message: `event ${i}` });
          emitted++;
        }
        return Promise.resolve("never delivered");
      },
      { requestId: "r", signal: new AbortController().signal, onFinish: (o) => outcomes.push(o) },
    );
    // Do not read the body at all: a connected but idle consumer.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(emitted).toBeLessThan(MAX_PENDING_CHUNKS * 3);
    expect(emitted).toBeGreaterThan(MAX_PENDING_CHUNKS - 5);
    expect(outcomes).toEqual([expect.objectContaining({ ok: false, closedByClient: true })]);
    await response.body?.cancel();
  });

  it("a consumer that reads normally is not affected, even for a long run", async () => {
    const response = sseResponse(
      ({ emit }) => {
        for (let i = 0; i < MAX_PENDING_CHUNKS - 50; i++) emit({ type: "note", message: `e${i}` });
        return Promise.resolve("ok");
      },
      { requestId: "r", signal: new AbortController().signal },
    );
    const text = await response.text();
    expect(text).toContain("event: result");
    expect((text.match(/event: note/g) ?? []).length).toBe(MAX_PENDING_CHUNKS - 50);
  });
});

/** Edge cases for the smoke checks: broken servers, odd answers and odd addresses. */
import { afterEach, describe, expect, it } from "vitest";
import { POST as explore } from "../src/app/api/explore/route";
import { GET as health } from "../src/app/api/health/route";
import { POST as plan } from "../src/app/api/plan/route";
import { POST as privacy } from "../src/app/api/privacy/route";
import { POST as whatif } from "../src/app/api/whatif/route";
import { createMockClient } from "../src/lib/model";
import { runSmoke, type SmokeResult } from "../scripts/lib/smoke";
import { installServices, resetServices } from "./helpers/api";

afterEach(resetServices);

type Handler = (request: Request) => Response | Promise<Response>;
const BASE = "http://smoke.test";

/** A fetch that answers from the real route handlers, with optional per-path replacements. */
function fakeFetch(overrides: Record<string, Handler> = {}): typeof fetch {
  const routes: Record<string, Handler> = {
    "/api/health": () => health(),
    "/": () =>
      new Response("<html><body>Orionmatter</body></html>", { headers: { "content-type": "text/html" } }),
    "/api/explore": explore,
    "/api/privacy": privacy,
    "/api/whatif": whatif,
    "/api/plan": plan,
    ...overrides,
  };
  return ((input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    const handler = routes[path];
    if (!handler) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(handler(new Request(input, init)));
  }) as typeof fetch;
}
const install = () =>
  installServices(createMockClient([]), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
const byName = (results: SmokeResult[], start: string) => results.find((r) => r.name.startsWith(start));
const json =
  (body: unknown, status = 200): Handler =>
  () =>
    Response.json(body, { status });

describe("smoke timings", () => {
  it("a passing check reports how long it really took, not zero", async () => {
    // Regression: the clock was read in the same object literal as the await, so every passing check showed 0 ms.
    install();
    const slow: Handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return health();
    };
    const results = await runSmoke(BASE, { fetch: fakeFetch({ "/api/health": slow }) });
    const timed = byName(results, "health");
    expect(timed?.ok).toBe(true);
    expect(timed?.ms).toBeGreaterThanOrEqual(140);
  });
});

describe("smoke checks against odd servers", () => {
  it("a server whose JSON is invalid fails that check with the parse error, and nothing throws", async () => {
    install();
    const results = await runSmoke(BASE, {
      fetch: fakeFetch({ "/api/health": () => new Response("this is not json", { status: 200 }) }),
    });
    expect(results).toHaveLength(5);
    expect(byName(results, "health")?.ok).toBe(false);
    expect(byName(results, "health")?.detail.length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.name.startsWith("health")).every((r) => r.ok)).toBe(true);
  });

  it("a stream that closes without events fails the What if check with 'no result'", async () => {
    install();
    const empty = new Response(new ReadableStream({ start: (c) => c.close() }), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const results = await runSmoke(BASE, {
      fetch: fakeFetch({ "/api/whatif": () => empty }),
      model: true,
    });
    expect(byName(results, "what if")?.ok).toBe(false);
    expect(byName(results, "what if")?.detail).toContain("no result");
  });

  it("a health answer that is an array fails: arrays pass the object check but have no ok field", async () => {
    install();
    const results = await runSmoke(BASE, { fetch: fakeFetch({ "/api/health": json([true]) }) });
    expect(byName(results, "health")?.ok).toBe(false);
    expect(byName(results, "health")?.detail).toContain("ok is not true");
  });

  it("an explore answer where routes is a string reads as zero routes", async () => {
    install();
    const results = await runSmoke(BASE, {
      fetch: fakeFetch({ "/api/explore": json({ routes: "three" }) }),
    });
    expect(byName(results, "explore")?.ok).toBe(false);
    expect(byName(results, "explore")?.detail).toBe("0 routes");
  });

  it("a ladder whose sizes are equal passes: shrinking allows ties", async () => {
    install();
    const ladder = [{ size: 40 }, { size: 40 }, { size: 40 }];
    const results = await runSmoke(BASE, { fetch: fakeFetch({ "/api/privacy": json({ ladder }) }) });
    expect(byName(results, "privacy")?.ok).toBe(true);
    expect(byName(results, "privacy")?.detail).toBe("crowd sizes 40 > 40 > 40");
  });

  it("a ladder with NaN sizes fails the shrink check, because NaN <= anything is false", async () => {
    install();
    const ladder = [{ size: "big" }, { size: "small" }, { size: "tiny" }];
    const results = await runSmoke(BASE, { fetch: fakeFetch({ "/api/privacy": json({ ladder }) }) });
    expect(byName(results, "privacy")?.ok).toBe(false);
    expect(byName(results, "privacy")?.detail).toContain("not shrinking");
  });

  it("a base URL with a path prefix is kept, so every check misses and reports 404", async () => {
    const results = await runSmoke("http://x/app", { fetch: fakeFetch() });
    expect(results).toHaveLength(5);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(byName(results, "health")?.detail).toContain("status 404");
  });

  it("results keep a fixed order and onResult fires once per check in the same order", async () => {
    install();
    const seen: string[] = [];
    const results = await runSmoke(BASE, { fetch: fakeFetch(), onResult: (r) => seen.push(r.name) });
    expect(results.map((r) => r.name.split(":")[0])).toEqual([
      "health",
      "page",
      "explore",
      "privacy",
      "validation",
    ]);
    expect(seen).toEqual(results.map((r) => r.name));
  });

  it("a check that throws a non-Error value records its String() form and never throws", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejecting with a string is the point: runSmoke must record String(error), never throw
    const rejected = (() => Promise.reject("boom")) as typeof fetch;
    const results = await runSmoke(BASE, { fetch: rejected });
    expect(results).toHaveLength(5);
    expect(results.every((r) => !r.ok && r.detail === "boom")).toBe(true);
  });
});

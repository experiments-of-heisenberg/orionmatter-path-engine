/** The smoke checks, run in-process against the real routes, and against servers that are wrong in each way they look for. */
import { afterEach, describe, expect, it } from "vitest";
import { POST as explore } from "../src/app/api/explore/route";
import { GET as health } from "../src/app/api/health/route";
import { POST as plan } from "../src/app/api/plan/route";
import { POST as privacy } from "../src/app/api/privacy/route";
import { POST as whatif } from "../src/app/api/whatif/route";
import { createMockClient, reply } from "../src/lib/model";
import { runSmoke, type SmokeResult } from "../scripts/lib/smoke";
import { installServices, resetServices } from "./helpers/api";
import { compose, criticClean, skipGather } from "./helpers/plan";
import { says } from "./helpers/whatif";

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
const install = (steps = [] as Parameters<typeof createMockClient>[0]) =>
  installServices(createMockClient(steps), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
const byName = (results: SmokeResult[], start: string) => results.find((r) => r.name.startsWith(start));

describe("against a healthy server", () => {
  it("the code-only checks all pass, with no model", async () => {
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
    expect(results.every((r) => r.ok)).toBe(true);
    expect(seen).toHaveLength(5);
    expect(byName(results, "explore")?.detail).toBe("routes with 55, 65, 30 comparable engineers");
    expect(byName(results, "privacy")?.detail).toBe("crowd sizes 197 > 93 > 68 > 11");
    expect(byName(results, "health")?.detail).toContain("cohort of 484 (synthetic)");
  });

  it("a trailing slash on the address makes no difference", async () => {
    install();
    expect((await runSmoke(`${BASE}///`, { fetch: fakeFetch() })).every((r) => r.ok)).toBe(true);
  });

  it("with --model it also runs a What if example, and with --plan a full plan", async () => {
    const interpret = says({ changes: [{ field: "noRelocation", value: true, phrase: "won't relocate" }] });
    install([interpret, reply("not json"), reply("not json")]); // the narrator's two tries fail, so the template is used
    const modelRun = await runSmoke(BASE, { fetch: fakeFetch(), model: true });
    expect(modelRun.map((r) => r.name.split(":")[0])).toContain("what if");
    expect(byName(modelRun, "what if")?.ok).toBe(true);
    expect(byName(modelRun, "plan")).toBeUndefined();
    // One client that sends the planner's and the Skeptic's calls to one script and the What if calls to another.
    const planner = createMockClient([skipGather, compose, criticClean]);
    const other = createMockClient([interpret, reply("not json"), reply("not json")]);
    installServices(
      {
        chat: (request) =>
          /^(planner|skeptic)/.test(request.label) ? planner.chat(request) : other.chat(request),
      },
      { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" },
    );
    const planRun = await runSmoke(BASE, { fetch: fakeFetch(), plan: true });
    expect(byName(planRun, "plan")?.ok).toBe(true);
    expect(byName(planRun, "plan")?.detail).toMatch(/^status approved, \d+ events$/);
    expect(planRun.every((r) => r.ok)).toBe(true);
  });
});

describe("against a server that is wrong", () => {
  it("a server that is down fails every check with the reason, and never throws", async () => {
    const down = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const results = await runSmoke(BASE, { fetch: down });
    expect(results).toHaveLength(5);
    expect(results.every((r) => !r.ok && r.detail.includes("fetch failed"))).toBe(true);
  });

  it("each way a check can be wrong is reported by that check alone", async () => {
    install();
    const json =
      (body: unknown, status = 200): Handler =>
      () =>
        Response.json(body, { status });
    const cases: [string, Record<string, Handler>, string, RegExp][] = [
      ["health", { "/api/health": json({ ok: false }) }, "health", /ok is not true/],
      [
        "health",
        { "/api/health": json({ ok: true, cohort: { synthetic: false } }) },
        "health",
        /not labelled synthetic/,
      ],
      [
        "health",
        {
          "/api/health": json({
            ok: true,
            mode: "live",
            apiKey: "sk-abcdefghijklmnop",
            cohort: { synthetic: true },
          }),
        },
        "health",
        /key-shaped/,
      ],
      ["page", { "/": () => new Response("nothing") }, "page", /does not mention Orionmatter/],
      ["page", { "/": () => new Response("Orionmatter MODEL_API_KEY") }, "page", /mentions the key variable/],
      ["page", { "/": () => new Response("x", { status: 500 }) }, "page", /status 500/],
      ["explore", { "/api/explore": json({ routes: [{}, {}] }) }, "explore", /2 routes/],
      [
        "explore",
        { "/api/explore": json({ routes: [{ n: 1 }, { n: 2 }, { n: 3 }], leak: "syn_0042" }) },
        "explore",
        /record ids leaked/,
      ],
      [
        "privacy",
        { "/api/privacy": json({ ladder: [{ size: 10 }, { size: 50 }, { size: 20 }] }) },
        "privacy",
        /not shrinking/,
      ],
      ["privacy", { "/api/privacy": json({ ladder: [{ size: 10 }] }) }, "privacy", /1 steps/],
      ["validation", { "/api/explore": json({}, 500) }, "validation", /status 500/],
      [
        "validation",
        { "/api/explore": json({ code: "internal", message: "x" }, 400) },
        "validation",
        /no stable code/,
      ],
      [
        "validation",
        { "/api/explore": json({ code: "invalid_request", message: "bad\n    at Module._compile" }, 400) },
        "validation",
        /stack trace/,
      ],
    ];
    for (const [, overrides, name, pattern] of cases) {
      const results = await runSmoke(BASE, { fetch: fakeFetch(overrides) });
      const hit = byName(results, name);
      expect(hit?.ok, `${name} should fail: ${JSON.stringify(overrides)}`).toBe(false);
      expect(hit?.detail).toMatch(pattern);
    }
  });

  it("a stream that ends in an error, or without a result, fails the model checks with what it said", async () => {
    install();
    const sse =
      (text: string): Handler =>
      () =>
        new Response(text, { headers: { "content-type": "text/event-stream" } });
    const errored = await runSmoke(BASE, {
      fetch: fakeFetch({
        "/api/whatif": sse('event: error\ndata: {"code":"demo_only","message":"not recorded"}\n\n'),
      }),
      model: true,
    });
    expect(byName(errored, "what if")?.ok).toBe(false);
    expect(byName(errored, "what if")?.detail).toContain("demo_only");
    const empty = await runSmoke(BASE, {
      fetch: fakeFetch({ "/api/whatif": sse("event: open\ndata: {}\n\n") }),
      model: true,
    });
    expect(byName(empty, "what if")?.detail).toContain("no result");
    const nothingApplied = await runSmoke(BASE, {
      fetch: fakeFetch({ "/api/whatif": sse('event: result\ndata: {"interpretation":{"applied":[]}}\n\n') }),
      model: true,
    });
    expect(byName(nothingApplied, "what if")?.detail).toContain("nothing was applied");
  });

  it("a plan without the Skeptic's verdict in the stream, or with the wrong number of routes, fails", async () => {
    install();
    const sse =
      (text: string): Handler =>
      () =>
        new Response(text, { headers: { "content-type": "text/event-stream" } });
    const noVerdict = await runSmoke(BASE, {
      fetch: fakeFetch({
        "/api/plan": sse('event: result\ndata: {"status":"approved","plan":{"routes":[1,2,3]}}\n\n'),
      }),
      plan: true,
    });
    expect(byName(noVerdict, "plan")?.detail).toContain("verdict was not streamed");
    const twoRoutes = await runSmoke(BASE, {
      fetch: fakeFetch({
        "/api/plan": sse(
          'event: verdict\ndata: {}\n\nevent: result\ndata: {"status":"approved","plan":{"routes":[1,2]}}\n\n',
        ),
      }),
      plan: true,
    });
    expect(byName(twoRoutes, "plan")?.detail).toContain("2 routes in the plan");
  });
});

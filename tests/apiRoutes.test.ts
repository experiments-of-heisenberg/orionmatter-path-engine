/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument --
   These tests assert the shape of JSON responses; typing every nested field would restate the schema. */
/**
 * Tests for the API routes, called as plain (Request) => Response functions with a scripted model:
 * guards (type, size, schema, rate, concurrency), the shape of every response, streaming, error
 * mapping, and that logs never carry request content.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GET as health } from "../src/app/api/health/route";
import { POST as explore } from "../src/app/api/explore/route";
import { POST as intake } from "../src/app/api/intake/route";
import { POST as plan } from "../src/app/api/plan/route";
import { POST as privacy } from "../src/app/api/privacy/route";
import { POST as whatif } from "../src/app/api/whatif/route";
import { createMockClient, reply, type ChatRequest, type MockStep } from "../src/lib/model";
import { draftFromRequest } from "./helpers/fixturesData";
import { installServices, person, post, readEvents, resetServices } from "./helpers/api";

afterEach(resetServices);

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const noModel = () => createMockClient([]);
const interpreterSays = (changes: unknown[]) =>
  reply(JSON.stringify({ changes, unsupported: [], contradictions: [], clarification: null }));

describe("GET /api/health", () => {
  it("reports the mode and whether a key is set, never the key", async () => {
    const { services } = installServices(noModel());
    const body = await json(health());
    expect(body).toEqual({
      ok: true,
      mode: "live",
      model: "muse-spark-1.3",
      keyConfigured: true,
      cohort: { records: 484, synthetic: true },
    });
    expect(JSON.stringify(body)).not.toContain(services.env.MODEL_API_KEY ?? "unset");
  });

  it("says fixtures when replaying", async () => {
    installServices(noModel(), { USE_FIXTURES: "true" });
    expect((await json(health()))["mode"]).toBe("fixtures");
  });
});

describe("POST /api/explore (no model)", () => {
  it("returns the fact sheet, tornado, what-would-it-take and conflicts", async () => {
    installServices(noModel());
    const response = await explore(post("explore", { ...person, constraints: { maxMonths: 12 } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual([
      "conflicts",
      "constraints",
      "goal",
      "ranking",
      "routes",
      "survivorship",
      "tornado",
      "twins",
      "wouldItTake",
    ]);
    expect((body["routes"] as unknown[]).length).toBe(3);
    expect((body["ranking"] as { recommended: unknown }).recommended).toBeNull(); // nobody finishes in 12 months
    expect((body["wouldItTake"] as { options: { to: string }[] }).options[0]?.to).toBe("23 months");
    expect((body["conflicts"] as { kind: string }[])[0]?.kind).toBe("infeasible");
  });

  it("never sends the list of twin ids to the browser", async () => {
    installServices(noModel());
    const text = await (await explore(post("explore", person))).text();
    expect(text).not.toContain("syn_0");
  });

  it("defaults constraints when they are omitted", async () => {
    installServices(noModel());
    const body = await json(await explore(post("explore", person)));
    expect(body["constraints"]).toEqual({ riskTolerance: "medium", addSkills: [] });
  });

  it("makes no model call", async () => {
    const client = noModel();
    installServices(client);
    await explore(post("explore", person));
    expect(client.requests).toHaveLength(0);
  });
});

describe("request guards, on every route", () => {
  const routes = [
    ["intake", intake],
    ["plan", plan],
    ["whatif", whatif],
    ["explore", explore],
    ["privacy", privacy],
  ] as const;

  it.each(routes)(
    "%s: 415 for a non-JSON body, 400 for bad JSON and for an unknown field",
    async (name, route) => {
      installServices(noModel());
      expect((await route(post(name, "x=1", { "content-type": "text/plain" }))).status).toBe(415);
      expect((await route(post(name, "{oops"))).status).toBe(400);
      const extra = await route(post(name, { ...person, message: "m", text: "t", hacker: true }));
      expect(extra.status).toBe(400);
      expect((await json(extra))["code"]).toBe("invalid_request");
    },
  );

  it.each(routes)("%s: 413 for an oversize body", async (name, route) => {
    installServices(noModel());
    const response = await route(post(name, { pad: "x".repeat(7 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect((await json(response))["code"]).toBe("payload_too_large");
  });

  it("the image route accepts a body of 1 MB that the other routes refuse as too large", async () => {
    installServices(noModel());
    const image = `data:image/png;base64,${"A".repeat(1_000_000)}`;
    const viaIntake = await readEvents(await intake(post("intake", { imageDataUrl: image })));
    expect(viaIntake.at(-1)).toMatchObject({ event: "error", data: { code: "invalid_request" } }); // reached the image check
    expect((await explore(post("explore", { imageDataUrl: image }))).status).toBe(413);
    expect((await plan(post("plan", { imageDataUrl: image }))).status).toBe(413);
  });

  it("returns field-level issues without echoing values", async () => {
    installServices(noModel());
    const response = await explore(
      post("explore", { profile: { roleFamily: "chef", secretNote: "hunter2" }, goal: person.goal }),
    );
    const body = await json(response);
    expect(response.status).toBe(400);
    expect((body["issues"] as { path: string }[]).some((i) => i.path === "profile.roleFamily")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });
});

describe("rate limiting and concurrency", () => {
  it("returns 429 with Retry-After once a client exceeds the model allowance, per client", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "2" });
    const call = (ip: string) =>
      privacy(post("privacy", { ...person, useModel: false }, { "x-forwarded-for": ip }));
    expect((await call("1.1.1.1")).status).toBe(200);
    expect((await call("1.1.1.1")).status).toBe(200);
    const limited = await call("1.1.1.1");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await json(limited))["code"]).toBe("rate_limited");
    expect((await call("2.2.2.2")).status).toBe(200); // another client is unaffected
  });

  it("recovers after the window passes", async () => {
    const { clock } = installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "1" });
    const call = () => privacy(post("privacy", { ...person, useModel: false }));
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
    clock.now += 61_000;
    expect((await call()).status).toBe(200);
  });

  it("gives the plan route a third of the model allowance", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "3" });
    // The plan limiter allows 1 per minute: the second request is refused before any model work.
    const first = await plan(post("plan", person));
    await first.body?.cancel();
    expect((await plan(post("plan", person))).status).toBe(429);
  });

  it("the model-free route has a much larger allowance", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "1" });
    for (let i = 0; i < 10; i++) expect((await explore(post("explore", person))).status).toBe(200);
  });

  it("answers 503 busy when too many model runs are in flight, then recovers", async () => {
    const { services } = installServices(noModel(), {
      MAX_CONCURRENT_RUNS: "1",
      RATE_LIMIT_PER_MINUTE: "100",
    });
    const holder = services.gate.tryEnter();
    const busy = await privacy(post("privacy", { ...person, useModel: false }));
    expect(busy.status).toBe(503);
    expect((await json(busy))["code"]).toBe("busy");
    expect(busy.headers.get("retry-after")).toBe("5");
    holder?.();
    expect((await privacy(post("privacy", { ...person, useModel: false }))).status).toBe(200);
  });

  it("frees the slot after a streamed run finishes, fails, or is abandoned", async () => {
    const { services } = installServices(createMockClient([interpreterSays([])]), {
      MAX_CONCURRENT_RUNS: "1",
      RATE_LIMIT_PER_MINUTE: "100",
    });
    const ok = await whatif(post("whatif", { ...person, message: "hello", narrate: false }));
    expect(services.gate.inFlight).toBe(1); // the stream owns the slot while it runs
    await readEvents(ok);
    expect(services.gate.inFlight).toBe(0);
    const failing = await whatif(post("whatif", { ...person, message: "hello", narrate: false })); // the mock is exhausted: the run fails
    await readEvents(failing);
    expect(services.gate.inFlight).toBe(0);
  });

  it("does not hold a slot for a request the guards reject", async () => {
    const { services } = installServices(noModel(), { MAX_CONCURRENT_RUNS: "1" });
    await privacy(post("privacy", "{oops"));
    expect(services.gate.inFlight).toBe(0);
  });
});

describe("POST /api/privacy", () => {
  it("returns the assessment as JSON", async () => {
    installServices(
      createMockClient([
        reply(
          JSON.stringify({
            findings: [{ quote: "Acme Robotics", category: "employer", reason: "named company" }],
          }),
        ),
      ]),
    );
    const response = await privacy(post("privacy", { ...person, text: "I worked at Acme Robotics." }));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body["risk"]).toBe("medium");
    expect(body["generalisedText"]).toBe("I worked at [a company].");
    expect(body["textCheck"]).toBe("done");
  });

  it("rejects over-long text and a bad k with 400", async () => {
    installServices(noModel());
    expect((await privacy(post("privacy", { ...person, text: "x".repeat(3100) }))).status).toBe(400);
    expect((await privacy(post("privacy", { ...person, k: 0 }))).status).toBe(400);
    expect((await privacy(post("privacy", { ...person, k: 2.5 }))).status).toBe(400);
  });
});

describe("POST /api/intake (streaming)", () => {
  it("streams a reading stage and then the result", async () => {
    const reading = {
      roleFamily: { value: "backend", quote: "backend engineer" },
      level: { value: "L5", quote: "L5" },
      company: null,
      title: null,
      yearsExperience: { value: 7, quote: "7 years" },
      region: { value: "IN-south", quote: "Bangalore" },
      compBand: null,
      stack: ["go"],
      milestones: [],
      goal: null,
    };
    installServices(createMockClient([reply(JSON.stringify(reading))]));
    const response = await intake(
      post("intake", { text: "I am a backend engineer, L5, 7 years, in Bangalore. I use Go." }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(response);
    expect(events.map((e) => e.event)).toEqual(["open", "stage", "result"]);
    expect(events[2]?.data).toMatchObject({ status: "complete", verified: false, profile: { level: "L5" } });
  });

  it("answers a bad image with 400 as a stream error event", async () => {
    installServices(noModel());
    const response = await intake(post("intake", { imageDataUrl: "data:image/png;base64,AAAA" }));
    const events = await readEvents(response);
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "invalid_request" } });
  });

  it("answers empty input with an error event whose message is for a person", async () => {
    installServices(noModel());
    const events = await readEvents(await intake(post("intake", {})));
    expect(events.at(-1)?.data).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("Write a few lines") as string,
    });
  });
});

describe("POST /api/whatif (streaming)", () => {
  it("streams stages and returns the interpretation, both sheets, the diff, the narration, the tornado and the smallest changes", async () => {
    installServices(
      createMockClient([interpreterSays([{ field: "maxMonths", value: 24, phrase: "within 2 years" }])]),
    );
    const events = await readEvents(
      await whatif(post("whatif", { ...person, message: "I want it within 2 years", narrate: false })),
    );
    expect(events.map((e) => e.event)).toEqual(["open", "stage", "result"]);
    const result = events.at(-1)?.data as Record<string, any>;
    expect(Object.keys(result).sort()).toEqual([
      "after",
      "before",
      "diff",
      "interpretation",
      "narration",
      "tornado",
      "wouldItTake",
    ]);
    expect(result["interpretation"].next.maxMonths).toBe(24);
    expect(result["after"].ranking.recommended).toBe("jump");
    expect(result["before"].ranking.recommended).toBe("climb");
    expect(result["diff"].recommended).toEqual({ before: "climb", after: "jump", changed: true });
    expect(result["narration"].source).toBe("template");
    expect(result["tornado"].bars[0].knob).toBe("maxMonths");
    expect(result["wouldItTake"].alreadyMet).toBe(true);
  });

  it("computes the tornado for the NEW constraints, not the old ones", async () => {
    installServices(
      createMockClient([interpreterSays([{ field: "maxMonths", value: 12, phrase: "within a year" }])]),
    );
    const events = await readEvents(
      await whatif(post("whatif", { ...person, message: "within a year", narrate: false })),
    );
    const result = events.at(-1)?.data as Record<string, any>;
    expect(result["tornado"].baseline.route).toBeNull();
    expect(result["wouldItTake"].options[0].to).toBe("23 months");
  });

  it("maps an interpreter that cannot be read to a typed 502 error event", async () => {
    installServices(createMockClient([reply("not json"), reply("not json")]));
    const events = await readEvents(
      await whatif(post("whatif", { ...person, message: "x", narrate: false })),
    );
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "model_unreadable", retryAfter: 2 },
    });
  });

  it("maps an over-long message to a 400-class error event", async () => {
    installServices(noModel());
    const events = await readEvents(await whatif(post("whatif", { ...person, message: "x".repeat(600) })));
    expect(events.at(-1)?.data).toMatchObject({ code: "invalid_request" });
  });
});

describe("POST /api/plan (streaming)", () => {
  const skipGather = reply("EVIDENCE COMPLETE");
  const compose: MockStep = (request: ChatRequest) => reply(draftFromRequest(request));
  const criticClean = reply('{"issues":[],"notes":[]}');

  it("streams every agent step, then a verified plan with the evidence trail and without twin ids", async () => {
    installServices(createMockClient([skipGather, compose, criticClean]));
    const events = await readEvents(await plan(post("plan", person)));
    const names = events.map((e) => e.event);
    expect(names[0]).toBe("open");
    expect(names).toContain("stage");
    expect(names).toContain("tool_call");
    expect(names).toContain("tool_result");
    expect(names).toContain("verdict");
    expect(names.at(-1)).toBe("result");
    expect(names.filter((n) => n === "result")).toHaveLength(1);
    const result = events.at(-1)?.data as Record<string, any>;
    expect(result["status"]).toBe("approved");
    expect(result["plan"].routes).toHaveLength(3);
    expect(result["evidence"].map((e: { tool: string }) => e.tool)).toEqual([
      "findTwins",
      "compBands",
      "pathStats",
      "pathStats",
      "pathStats",
    ]);
    expect(JSON.stringify(result)).not.toContain("syn_0");
    expect(result["sheet"].twins.n).toBe(150);
  });

  it("every evidence id a route cites appears in the evidence trail", async () => {
    installServices(createMockClient([skipGather, compose, criticClean]));
    const result = (await readEvents(await plan(post("plan", person)))).at(-1)?.data as Record<string, any>;
    const ids = new Set(result["evidence"].map((e: { evidenceId: string }) => e.evidenceId));
    for (const route of result["plan"].routes)
      for (const id of route.evidenceIds) expect(ids.has(id)).toBe(true);
  });

  it("reports an unresolved plan honestly through the stream when the Skeptic never approves", async () => {
    const bad: MockStep = (request: ChatRequest) => {
      const draft = JSON.parse(draftFromRequest(request)) as { routes: { summary: string }[] };
      draft.routes[0]!.summary = "You will definitely become Staff.";
      return reply(JSON.stringify(draft));
    };
    installServices(createMockClient([skipGather, bad, bad, bad]));
    const result = (await readEvents(await plan(post("plan", person)))).at(-1)?.data as Record<string, any>;
    expect(result["status"]).toBe("unresolved");
    expect(result["verdicts"].at(-1).approved).toBe(false);
    expect(result["verdicts"].at(-1).rejections.length).toBeGreaterThan(0);
  });
});

describe("logging", () => {
  it("logs one line per request with route, status and timing, and never the request content", async () => {
    const { logs } = installServices(noModel());
    await privacy(
      post("privacy", { ...person, text: "Mail jo@x.com, I worked at Acme Robotics", useModel: false }),
    );
    const line = JSON.parse(logs.find((l) => l.includes("api.request")) ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ message: "api.request", route: "privacy", status: 200 });
    expect(typeof line["ms"]).toBe("number");
    expect(line["client"]).toMatch(/^[0-9a-f]{8}$/);
    const all = logs.join("\n");
    for (const secret of ["jo@x.com", "Acme Robotics", "Staff Engineer", "IN-south"])
      expect(all).not.toContain(secret);
  });

  it("logs the client as an anonymous label, never the address", async () => {
    const { logs } = installServices(noModel());
    await explore(post("explore", person, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(logs.join("\n")).not.toContain("203.0.113.9");
  });

  it("logs the detail of an unexpected error but returns only a generic message", async () => {
    const { logs } = installServices({ chat: () => Promise.reject(new Error("db password hunter2")) });
    const events = await readEvents(
      await whatif(post("whatif", { ...person, message: "hi", narrate: false })),
    );
    expect(events.at(-1)?.data).toEqual({ code: "internal", message: "Something went wrong on our side." });
    expect(JSON.stringify(events)).not.toContain("hunter2");
    const errorLine = logs.find((line) => line.includes('"api.error"')) ?? "";
    expect(errorLine).toContain('"code":"internal"');
    expect(errorLine).toContain("hunter2"); // the operator sees it; the browser does not
  });

  it("redacts the configured key if an error message happens to contain it", async () => {
    const { logs } = installServices({ chat: () => Promise.reject(new Error("bad key test-key-not-real")) });
    await readEvents(await whatif(post("whatif", { ...person, message: "hi", narrate: false })));
    expect(logs.join("\n")).not.toContain("test-key-not-real");
    expect(logs.join("\n")).toContain("[REDACTED]");
  });
});

/**
 * Edge tests for the route wrapper and the route modules: client identity,
 * error responses, errors thrown inside a run, gate-full accounting, parallel
 * limit behaviour, stream headers and request ids, odd bodies, health, and the
 * exported methods and config of every route module.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GET as health } from "../src/app/api/health/route";
import * as exploreModule from "../src/app/api/explore/route";
import * as healthModule from "../src/app/api/health/route";
import * as intakeModule from "../src/app/api/intake/route";
import * as planModule from "../src/app/api/plan/route";
import * as privacyModule from "../src/app/api/privacy/route";
import * as whatifModule from "../src/app/api/whatif/route";
import { POST as explore } from "../src/app/api/explore/route";
import { POST as privacy } from "../src/app/api/privacy/route";
import { POST as whatif } from "../src/app/api/whatif/route";
import { ApiError } from "../src/lib/api/errors";
import { clientKey, clientLabel, defineRoute, errorResponse } from "../src/lib/api/route";
import { IntakeRequest, PlanRequest } from "../src/lib/api/schemas";
import { SSE_HEADERS } from "../src/lib/api/sse";
import { createMockClient, ModelHttpError, reply, type ChatResult, type ModelClient } from "../src/lib/model";
import { installServices, person, post, readEvents, resetServices } from "./helpers/api";

afterEach(resetServices);

const noModel = () => createMockClient([]);
const jsonOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;
const requestWith = (headers: Record<string, string>): Request =>
  new Request("http://localhost/api/x", { headers });

describe("clientKey", () => {
  it("uses the first hop of x-forwarded-for, trimmed", () => {
    expect(clientKey(requestWith({ "x-forwarded-for": "  203.0.113.9 , 10.0.0.1, 10.0.0.2" }))).toBe(
      "203.0.113.9",
    );
  });

  it("falls back from an empty x-forwarded-for to x-real-ip, then to 'unknown'", () => {
    expect(clientKey(requestWith({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" }))).toBe(
      "198.51.100.7",
    );
    expect(clientKey(requestWith({}))).toBe("unknown");
  });

  it("states: two clients behind the same 'unknown' key share one rate-limit bucket", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "1" });
    const call = () => privacy(post("privacy", { ...person, useModel: false }));
    expect((await call()).status).toBe(200);
    // No forwarding headers on either request, so both are keyed "unknown"
    // and the second one finds the bucket already spent.
    expect((await call()).status).toBe(429);
  });
});

describe("clientLabel", () => {
  it("is stable for the same input, differs for different inputs, and is 8 hex characters", () => {
    expect(clientLabel("203.0.113.9")).toBe(clientLabel("203.0.113.9"));
    expect(clientLabel("203.0.113.9")).not.toBe(clientLabel("198.51.100.7"));
    expect(clientLabel("203.0.113.9")).toMatch(/^[0-9a-f]{8}$/);
    expect(clientLabel("unknown")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("errorResponse", () => {
  it("sends status 499 as 400", () => {
    const response = errorResponse(new ApiError("client_closed", 499, "cancelled"), "req-1");
    expect(response.status).toBe(400);
  });

  it("sends Retry-After only when retryAfter is set", () => {
    expect(
      errorResponse(new ApiError("rate_limited", 429, "slow", { retryAfter: 12 }), "req-1").headers.get(
        "retry-after",
      ),
    ).toBe("12");
    expect(
      errorResponse(new ApiError("invalid_request", 400, "bad"), "req-1").headers.get("retry-after"),
    ).toBeNull();
  });

  it("always carries X-Request-Id, Cache-Control no-store, and the error body", async () => {
    const response = errorResponse(new ApiError("busy", 503, "later", { retryAfter: 5 }), "req-7");
    expect(response.headers.get("x-request-id")).toBe("req-7");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await jsonOf(response)).toEqual({ code: "busy", message: "later", retryAfter: 5 });
  });
});

describe("errors thrown inside a JSON-mode run", () => {
  it("maps a ModelHttpError to 503 with Retry-After", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "100" });
    const route = defineRoute({
      name: "probe",
      schema: IntakeRequest,
      maxBytes: 1024,
      limiter: "light",
      usesModel: false,
      mode: "json",
      run: () => Promise.reject(new ModelHttpError(503, "upstream is down", 4000)),
    });
    const response = await route(post("probe", {}));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(await jsonOf(response)).toMatchObject({ code: "model_unavailable" });
  });

  it("maps a ZodError thrown inside the run to 400", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "100" });
    const route = defineRoute({
      name: "probe",
      schema: IntakeRequest,
      maxBytes: 1024,
      limiter: "light",
      usesModel: false,
      mode: "json",
      run: () => {
        PlanRequest.parse({}); // throws a ZodError
        return Promise.resolve({});
      },
    });
    const response = await route(post("probe", {}));
    expect(response.status).toBe(400);
    const body = await jsonOf(response);
    expect(body["code"]).toBe("invalid_request");
    expect(body["issues"]).toBeDefined();
  });
});

describe("gate-full accounting", () => {
  it("states: a 503 busy request still consumed its rate-limit hit", async () => {
    const { services } = installServices(noModel(), {
      RATE_LIMIT_PER_MINUTE: "1",
      MAX_CONCURRENT_RUNS: "1",
    });
    const holder = services.gate.tryEnter();
    const busy = await privacy(post("privacy", { ...person, useModel: false }));
    expect(busy.status).toBe(503);
    expect((await jsonOf(busy))["code"]).toBe("busy");
    holder?.();
    // The rate limit is checked before the gate, so the refused request spent
    // the client's single hit for this window: the retry is rate limited.
    expect((await privacy(post("privacy", { ...person, useModel: false }))).status).toBe(429);
    expect(services.gate.inFlight).toBe(0);
  });
});

describe("parallel limit behaviour", () => {
  it("30 parallel light requests with a limit of 10 per minute: exactly 10 succeed, 20 are 429", async () => {
    // RATE_LIMIT_PER_MINUTE 1 gives the light limiter 10 per minute.
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "1" });
    const responses = await Promise.all(Array.from({ length: 30 }, () => explore(post("explore", person))));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(10);
    const limited = responses.filter((r) => r.status === 429);
    expect(limited).toHaveLength(20);
    expect(await jsonOf(limited[0] ?? new Response("{}"))).toMatchObject({
      code: "rate_limited",
    });
  });

  it("8 parallel privacy runs with 2 slots: exactly 2 are served at once, 6 get 503 busy, then every slot is free", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let concurrent = 0;
    let maxSeen = 0;
    const blocking: ModelClient = {
      chat: (): Promise<ChatResult> => {
        concurrent++;
        maxSeen = Math.max(maxSeen, concurrent);
        return gate.then((): ChatResult => {
          concurrent--;
          return {
            text: JSON.stringify({ findings: [] }),
            toolCalls: [],
            finishReason: "stop",
            usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
            model: "blocking-test-double",
            attempts: 1,
            latencyMs: 0,
            fromFixture: false,
          };
        });
      },
    };
    const { services } = installServices(blocking, {
      RATE_LIMIT_PER_MINUTE: "1000",
      MAX_CONCURRENT_RUNS: "2",
    });
    const calls = Array.from({ length: 8 }, () =>
      privacy(post("privacy", { ...person, text: "I worked at Acme Robotics." })),
    );
    // Wait until both slots are inside the model call (bounded, so a hang fails fast).
    const deadline = Date.now() + 2000;
    while (maxSeen < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(maxSeen).toBe(2);
    expect(services.gate.inFlight).toBe(2);
    release();
    const responses = await Promise.all(calls);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(2);
    const busy = responses.filter((r) => r.status === 503);
    expect(busy).toHaveLength(6);
    expect(await jsonOf(busy[0] ?? new Response("{}"))).toMatchObject({ code: "busy" });
    expect(services.gate.inFlight).toBe(0);
  });
});

describe("stream headers and request ids", () => {
  it("a streamed response carries the SSE headers and an X-Request-Id equal to the open event id", async () => {
    installServices(
      createMockClient([
        reply(JSON.stringify({ changes: [], unsupported: [], contradictions: [], clarification: null })),
      ]),
      { RATE_LIMIT_PER_MINUTE: "100" },
    );
    const response = await whatif(post("whatif", { ...person, message: "hi", narrate: false }));
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(SSE_HEADERS)) expect(response.headers.get(name)).toBe(value);
    const events = await readEvents(response);
    expect(events[0]?.event).toBe("open");
    const open = events[0]?.data as { requestId: string };
    expect(response.headers.get("x-request-id")).toBe(open.requestId);
    expect(events.filter((e) => e.event === "result")).toHaveLength(1);
  });

  it("two different requests get different request ids", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "100" });
    const first = await explore(post("explore", person));
    const second = await explore(post("explore", person));
    expect(first.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.headers.get("x-request-id")).not.toBe(first.headers.get("x-request-id"));
  });
});

describe("odd bodies", () => {
  it("states: a leading UTF-8 BOM is stripped while decoding, so the request succeeds", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "100" });
    const response = await explore(
      new Request("http://localhost/api/explore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "\uFEFF" + JSON.stringify(person), // U+FEFF byte-order mark first
      }),
    );
    // TextDecoder (used by body.ts) drops a leading byte-order mark by default.
    expect(new TextDecoder("utf-8").decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBe("{}");
    expect(response.status).toBe(200);
  });

  it("states: invalid UTF-8 bytes become replacement characters, so the body is not valid JSON", async () => {
    installServices(noModel(), { RATE_LIMIT_PER_MINUTE: "100" });
    const response = await explore(
      new Request("http://localhost/api/explore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([0xff, 0xfe, 0xfd]),
      }),
    );
    expect(response.status).toBe(400);
    expect(await jsonOf(response)).toMatchObject({
      code: "invalid_request",
      message: "The request body is not valid JSON.",
    });
  });
});

describe("health", () => {
  it("takes no services (it uses getServices itself) and works with USE_FIXTURES without revealing the key", async () => {
    expect(health.length).toBe(0);
    installServices(noModel(), { USE_FIXTURES: "true" });
    const response = health();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text) as Record<string, unknown>).toMatchObject({
      ok: true,
      mode: "fixtures",
      cohort: { records: 484, synthetic: true },
    });
    expect(text).not.toContain("test-key-not-real");
  });
});

describe("route module methods", () => {
  it("the five POST routes export POST and no other method", () => {
    for (const module of [intakeModule, planModule, whatifModule, exploreModule, privacyModule]) {
      expect(Object.keys(module)).toContain("POST");
      for (const method of ["GET", "PUT", "DELETE", "PATCH"])
        expect(Object.keys(module)).not.toContain(method);
    }
  });

  it("health exports GET and no other method", () => {
    expect(Object.keys(healthModule)).toContain("GET");
    for (const method of ["POST", "PUT", "DELETE", "PATCH"])
      expect(Object.keys(healthModule)).not.toContain(method);
  });
});

describe("route module config", () => {
  it("all six routes run on nodejs and are force-dynamic", () => {
    for (const module of [
      intakeModule,
      planModule,
      whatifModule,
      exploreModule,
      privacyModule,
      healthModule,
    ]) {
      expect(module.runtime).toBe("nodejs");
      expect(module.dynamic).toBe("force-dynamic");
    }
  });

  it("maxDuration is set for the slow routes: plan 300, intake 120, whatif 120, privacy 60", () => {
    expect(planModule.maxDuration).toBe(300);
    expect(intakeModule.maxDuration).toBe(120);
    expect(whatifModule.maxDuration).toBe(120);
    expect(privacyModule.maxDuration).toBe(60);
    expect("maxDuration" in exploreModule).toBe(false);
    expect("maxDuration" in healthModule).toBe(false);
  });
});

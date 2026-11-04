/**
 * smoke.ts: the checks behind `npm run smoke`, written against any base URL.
 *
 * The same checks run against `next start` on a laptop, against a preview deployment and against production, so a
 * deploy is verified by the thing a judge will actually load. Each check is small and says what it expected. The fetch
 * is injectable, so the checks themselves are tested in-process (including what they do when the server is wrong).
 */
import { parseSse } from "../../src/lib/api/sseClient";

export interface SmokeOptions {
  /** Also run the model-backed What if example. In a demo build it replays; against a live server it costs a few cents. */
  model?: boolean;
  /** Also run a full plan (about half a minute live). Implies `model`. */
  plan?: boolean;
  fetch?: typeof fetch;
  /** Called after each check, for printing as it goes. */
  onResult?: (result: SmokeResult) => void;
}

export interface SmokeResult {
  name: string;
  ok: boolean;
  ms: number;
  /** What was seen, or what went wrong. */
  detail: string;
}

const PERSON = {
  profile: {
    roleFamily: "backend",
    level: "L5",
    yearsExperience: 7,
    stack: ["go", "kubernetes"],
    region: "IN-south",
    milestones: [],
  },
  goal: { targetLevel: "L6", label: "Staff Engineer" },
  constraints: { riskTolerance: "medium", addSkills: [] },
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

/** Read an event stream to its single `result` or `error` event. */
async function readStream(
  response: Response,
): Promise<{ events: string[]; result?: unknown; error?: unknown }> {
  const events: string[] = [];
  if (!response.body) return { events };
  for await (const { event, data } of parseSse(response.body)) {
    events.push(event);
    if (event === "result") return { events, result: data };
    if (event === "error") return { events, error: data };
  }
  return { events };
}

/** Run every check against `baseUrl` and return the results in order. Never throws: a failing check is a result. */
export async function runSmoke(baseUrl: string, options: SmokeOptions = {}): Promise<SmokeResult[]> {
  const doFetch = options.fetch ?? fetch;
  const base = baseUrl.replace(/\/+$/, "");
  const results: SmokeResult[] = [];
  const post = (path: string, body: unknown): Promise<Response> =>
    doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  async function check(name: string, run: () => Promise<string>): Promise<void> {
    const started = Date.now();
    let result: SmokeResult;
    try {
      // The detail is awaited first: in an object literal the properties are evaluated in order, so reading the clock in the
      // same literal as the await stopped it before the check had run and reported every passing check as 0 ms.
      const detail = await run();
      result = { name, ok: true, ms: Date.now() - started, detail };
    } catch (error) {
      result = {
        name,
        ok: false,
        ms: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(result);
    options.onResult?.(result);
  }
  const expect = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
  };

  let mode = "unknown";
  await check("health: the server is up and says what mode it is in", async () => {
    const response = await doFetch(`${base}/api/health`);
    expect(response.status === 200, `status ${response.status}`);
    const body: unknown = await response.json();
    expect(isObject(body) && body["ok"] === true, "ok is not true");
    const cohort = isObject(body) ? body["cohort"] : undefined;
    expect(isObject(cohort) && cohort["synthetic"] === true, "the cohort is not labelled synthetic");
    mode = isObject(body) ? String(body["mode"]) : "unknown";
    expect(
      !JSON.stringify(body).match(/api[_-]?key["']?\s*:\s*["'][^"']{8,}/i),
      "the health answer contains something key-shaped",
    );
    return `mode ${mode}, cohort of ${isObject(cohort) ? String(cohort["records"]) : "?"} (synthetic)`;
  });

  await check("page: the home page loads", async () => {
    const response = await doFetch(`${base}/`);
    expect(response.status === 200, `status ${response.status}`);
    const html = await response.text();
    expect(html.includes("Orionmatter"), "the page does not mention Orionmatter");
    expect(!html.includes("MODEL_API_KEY"), "the page mentions the key variable");
    return `${html.length} bytes of HTML`;
  });

  await check("explore: three routes for the sample engineer, from code, with no model", async () => {
    const response = await post("/api/explore", PERSON);
    expect(response.status === 200, `status ${response.status}`);
    const body: unknown = await response.json();
    const routes = isObject(body) && Array.isArray(body["routes"]) ? (body["routes"] as Json[]) : [];
    expect(routes.length === 3, `${routes.length} routes`);
    expect(JSON.stringify(body).includes("syn_") === false, "cohort record ids leaked into the answer");
    const sizes = routes.map((r) => String(r["n"])).join(", ");
    return `routes with ${sizes} comparable engineers`;
  });

  await check("privacy: the disclosure ladder shrinks and never grows", async () => {
    const response = await post("/api/privacy", { profile: PERSON.profile, goal: PERSON.goal, k: 10 });
    expect(response.status === 200, `status ${response.status}`);
    const body: unknown = await response.json();
    const ladder = isObject(body) && Array.isArray(body["ladder"]) ? (body["ladder"] as Json[]) : [];
    expect(ladder.length >= 3, `${ladder.length} steps`);
    const sizes = ladder.map((r) => Number(r["size"]));
    expect(
      sizes.every((size, i) => i === 0 || size <= (sizes[i - 1] ?? Infinity)),
      `sizes ${sizes.join(", ")} are not shrinking`,
    );
    return `crowd sizes ${sizes.join(" > ")}`;
  });

  await check("validation: a malformed request is refused with a reason, not a crash", async () => {
    const response = await post("/api/explore", { profile: { roleFamily: "wizard" } });
    expect(response.status === 400, `status ${response.status}`);
    const body: unknown = await response.json();
    expect(isObject(body) && body["code"] === "invalid_request", "the error has no stable code");
    expect(!JSON.stringify(body).includes("    at "), "a stack trace was returned");
    return "400 invalid_request";
  });

  if (options.model || options.plan) {
    await check("what if: an example sentence is understood, applied and explained", async () => {
      const response = await post("/api/whatif", {
        message: "What if I won't relocate?",
        current: PERSON.constraints,
        profile: PERSON.profile,
        goal: PERSON.goal,
      });
      expect(response.status === 200, `status ${response.status}`);
      const { events, result, error } = await readStream(response);
      expect(error === undefined, `the stream reported ${JSON.stringify(error)}`);
      expect(isObject(result), `no result (events: ${events.join(", ")})`);
      const reading = isObject(result) ? result["interpretation"] : undefined;
      const applied = isObject(reading) && Array.isArray(reading["applied"]) ? reading["applied"].length : 0;
      expect(applied > 0, "nothing was applied");
      return `${applied} change applied (${mode})`;
    });
  }

  if (options.plan) {
    await check("plan: the Planner and the Skeptic return a plan, with every step streamed", async () => {
      const response = await post("/api/plan", PERSON);
      expect(response.status === 200, `status ${response.status}`);
      const { events, result, error } = await readStream(response);
      expect(error === undefined, `the stream reported ${JSON.stringify(error)}`);
      expect(isObject(result), `no result (events: ${events.join(", ")})`);
      const status = isObject(result) ? String(result["status"]) : "?";
      expect(events.includes("verdict"), "the Skeptic's verdict was not streamed");
      const routes =
        isObject(result) && isObject(result["plan"]) && Array.isArray(result["plan"]["routes"])
          ? result["plan"]["routes"].length
          : 0;
      expect(routes === 3, `${routes} routes in the plan`);
      return `status ${status}, ${events.length} events`;
    });
  }

  return results;
}

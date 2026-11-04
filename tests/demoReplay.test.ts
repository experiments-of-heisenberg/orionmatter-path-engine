/**
 * The offline demo, as a test: every one-click example replays from the recorded Muse Spark answers in src/fixtures
 * with no network and no key. If an example text, a prompt or the evidence ids change, a recording stops matching and
 * this fails, which is the reminder to run `npm run record:demo` again.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST as intakeRoute } from "../src/app/api/intake/route";
import { POST as planRoute } from "../src/app/api/plan/route";
import { POST as whatifRoute } from "../src/app/api/whatif/route";
import { handleIntake, handlePlan, handlePrivacy, handleWhatIf } from "../src/lib/api/handlers";
import { IntakeRequest, PlanRequest, PrivacyRequest, WhatIfRequest } from "../src/lib/api/schemas";
import type { Services } from "../src/lib/api/services";
import { parseEnv } from "../src/lib/env";
import { FileFixtureStore, createModelClient } from "../src/lib/model";
import { DEMO_BIO, DEMO_STORY, WHATIF_EXAMPLES, exampleMessage } from "../src/ui/demo";
import { formFromDraft, personFromForm } from "../src/ui/intake";
import { normalise } from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { installServices, post, readEvents, resetServices } from "./helpers/api";

const env = parseEnv({ USE_FIXTURES: "true" });
const client = createModelClient(env, {
  fixtureMode: "replay",
  fixtures: new FileFixtureStore("src/fixtures"),
});
const services = { client } as unknown as Services;
const quiet = (): void => undefined;
const person = { profile: SAMPLE_PERSON.profile, goal: SAMPLE_PERSON.goal };

describe("the recordings themselves", () => {
  const files = readdirSync("src/fixtures").filter((f) => f.endsWith(".json"));
  it("exist, are valid, were made by the model the project uses, and hold no key-shaped text", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    for (const file of files) {
      const text = readFileSync(`src/fixtures/${file}`, "utf8");
      const parsed = JSON.parse(text) as {
        key: string;
        label: string;
        result: { model: string; text: string };
      };
      expect(parsed.key.startsWith(file.replace(".json", ""))).toBe(true);
      expect(parsed.result.model).toBe("muse-spark-1.3");
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|api[_-]?key"\s*:/i);
    }
  });
  it("cover every kind of call the examples make", () => {
    const labels = new Set(
      files.map((f) => (JSON.parse(readFileSync(`src/fixtures/${f}`, "utf8")) as { label: string }).label),
    );
    for (const label of [
      "intake:text",
      "whatif:interpret",
      "whatif:narrate",
      "planner:gather:turn1",
      "planner:compose",
      "skeptic:critic",
      "privacy:review",
    ]) {
      expect(
        [...labels].some((l) => l.startsWith(label)),
        `no recording for ${label}`,
      ).toBe(true);
    }
  });
});

describe("Your story", () => {
  it("the example story replays and reads into exactly the person the app opens on", async () => {
    const result = await handleIntake(services, IntakeRequest.parse({ text: DEMO_STORY }), quiet);
    expect(result.status).toBe("complete");
    const confirmed = personFromForm(formFromDraft(result.draft));
    expect(confirmed.ok && confirmed.person).toEqual(SAMPLE_PERSON);
  });
});

describe("What if and the plans that follow", () => {
  const limitsAfter: object[] = [SAMPLE_PERSON.constraints];

  it.each(WHATIF_EXAMPLES.map((e) => [e]))(
    "the example %s replays: understood, applied and explained",
    async (example) => {
      const run = await handleWhatIf(
        services,
        WhatIfRequest.parse({
          message: exampleMessage(example),
          current: SAMPLE_PERSON.constraints,
          ...person,
        }),
        quiet,
      );
      expect(run.interpretation.applied.length).toBeGreaterThan(0);
      expect(run.narration.points.length).toBeGreaterThan(0);
      expect(run.narration.source).toBe("model");
      limitsAfter.push(normalise(run.interpretation.next));
    },
  );

  it("a plan replays for the starting limits and for the limits after each example, every one approved with every figure checked", async () => {
    expect(limitsAfter).toHaveLength(1 + WHATIF_EXAMPLES.length);
    for (const constraints of limitsAfter) {
      const events: string[] = [];
      const run = await handlePlan(services, PlanRequest.parse({ ...person, constraints }), (e) =>
        events.push(e.type),
      );
      expect(run.status, JSON.stringify(constraints)).toBe("approved");
      expect(run.plan.routes).toHaveLength(3);
      expect(events).toContain("verdict");
      expect(run.evidence.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("Privacy", () => {
  it("the example text replays: Muse Spark read it, and what it found is quoted from the text", async () => {
    const result = await handlePrivacy(
      services,
      PrivacyRequest.parse({ ...person, k: 10, text: DEMO_BIO, useModel: true }),
      quiet,
    );
    expect(result.textCheck).toBe("done");
    expect(result.risk).not.toBe("low");
    for (const finding of result.findings)
      expect(DEMO_BIO.toLowerCase()).toContain(finding.quote.toLowerCase());
    expect(result.findings.map((f) => f.quote)).toEqual(expect.arrayContaining(["jo@example.com"]));
  });
});

describe("through the real routes, as the browser calls them", () => {
  it("the plan route streams a replayed plan end to end, and the stream says the Skeptic checked it", async () => {
    installServices(client, {
      USE_FIXTURES: "true",
      RATE_LIMIT_PER_MINUTE: "1000",
      MAX_CONCURRENT_RUNS: "20",
    });
    try {
      const events = await readEvents(
        await planRoute(post("plan", { ...person, constraints: SAMPLE_PERSON.constraints })),
      );
      expect(events.at(-1)?.event).toBe("result");
      expect(events.map((e) => e.event)).toContain("verdict");
      expect((events.at(-1)?.data as { status: string }).status).toBe("approved");
    } finally {
      resetServices();
    }
  });
  it("a request that was not recorded is refused as demo-only, not as a broken server", async () => {
    installServices(client, {
      USE_FIXTURES: "true",
      RATE_LIMIT_PER_MINUTE: "1000",
      MAX_CONCURRENT_RUNS: "20",
    });
    try {
      const events = await readEvents(
        await whatifRoute(
          post("whatif", {
            message: "something nobody recorded",
            current: SAMPLE_PERSON.constraints,
            ...person,
          }),
        ),
      );
      expect(events.at(-1)?.event).toBe("error");
      expect(events.at(-1)?.data).toMatchObject({ code: "demo_only" });
      const intake = await readEvents(
        await intakeRoute(post("intake", { text: "a different story entirely" })),
      );
      expect(intake.at(-1)?.data).toMatchObject({ code: "demo_only" });
    } finally {
      resetServices();
    }
  });
});

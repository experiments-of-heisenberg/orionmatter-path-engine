/**
 * live-client-check.ts: end-to-end check of the model client against the REAL APIs.
 *
 * Unit tests prove the client's logic with fakes; this script proves it works with
 * Muse Spark. It exercises:
 *   1. budget escalation   a deliberately tiny token budget that reasoning will eat
 *   2. structured output   Zod-validated JSON with the repair retry available
 *   3. tool loop           a real tool (findTwins via the evidence ledger), checking the
 *                          model reports the tool's number rather than inventing one
 *   4. fixtures            record a live call, then replay it with no network
 *
 * Costs a few cents. Run via the credentials wrapper:
 *   npm run live:client   (with MODEL_API_KEY exported; see .env.example)
 * Logs go to stderr (redacted); the report goes to stdout. No keys are printed.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import {
  chatStructured,
  createModelClient,
  FileFixtureStore,
  runToolLoop,
  toolDefinition,
  type ChatRequest,
  type ModelTarget,
} from "../src/lib/model";
import { findTwins } from "../src/lib/tools";
import { EvidenceLedger, ToolArgSchemas } from "../src/lib/tools";
import { Profile } from "../src/lib/schemas";

const env = getEnv();
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const logger = createLogger({ level: "info", secrets });
const client = createModelClient(env, { logger });

interface CheckResult {
  check: string;
  ok: boolean;
  detail: string;
  ms: number;
}
const results: CheckResult[] = [];

/** Run one check, recording pass/fail, timing and a one-line detail. Never throws. */
async function check(name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  const started = Date.now();
  try {
    const { ok, detail } = await fn();
    results.push({ check: name, ok, detail, ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    results.push({
      check: name,
      ok: false,
      detail: `threw ${message.slice(0, 200)}`,
      ms: Date.now() - started,
    });
  }
}

const targets: ModelTarget[] = ["spark"];

// 1. Budget escalation: 200 tokens was fully consumed by reasoning on Muse Spark in Part 0.
for (const target of targets) {
  await check(`budget escalation [${target}]`, async () => {
    const result = await client.chat({
      label: `live:escalation:${target}`,
      target,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      maxCompletionTokens: 200,
    });
    return {
      ok: /ok/i.test(result.text),
      detail: `reply=${JSON.stringify(result.text.slice(0, 20))} attempts=${result.attempts} reasoningTokens=${result.usage.reasoningTokens}`,
    };
  });
}

// 2. Structured output.
const Parsed = z.object({ level: z.string(), years: z.number().int(), skills: z.array(z.string()) });
for (const target of targets) {
  await check(`structured output [${target}]`, async () => {
    const out = await chatStructured(
      client,
      {
        label: `live:structured:${target}`,
        target,
        reasoningEffort: "low",
        messages: [
          {
            role: "user",
            content:
              "Extract: 'Senior Backend Engineer at a fintech, 7 years, works in Go and Kubernetes.' Level should be L5.",
          },
        ],
      },
      Parsed,
    );
    return { ok: out.data.years === 7, detail: `${JSON.stringify(out.data)} repaired=${out.repaired}` };
  });
}

// 3. Tool loop with the real findTwins tool through the evidence ledger.
const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go"],
  region: "IN-south",
});
const goal = { targetLevel: "L6", label: "Staff" };
const truth = findTwins(profile, goal).n;
for (const target of targets) {
  await check(`tool loop [${target}]`, async () => {
    const ledger = new EvidenceLedger();
    const request: ChatRequest & { tools: ReturnType<typeof toolDefinition>[] } = {
      label: `live:tools:${target}`,
      target,
      reasoningEffort: "low",
      tools: [
        toolDefinition(
          "findTwins",
          "Find comparable engineers in the synthetic cohort for a profile and goal. Returns twinIds and n, the number of twins.",
          ToolArgSchemas.findTwins,
        ),
      ],
      messages: [
        {
          role: "user",
          content:
            `Use the findTwins tool for this profile: ${JSON.stringify(profile)} and goal ${JSON.stringify(goal)}. ` +
            "Then answer with one sentence stating exactly how many twins (n) the tool returned.",
        },
      ],
    };
    const out = await runToolLoop({
      client,
      request,
      execute: ({ name, args }) => {
        const call = ledger.callUntrusted(name, args);
        return call.ok
          ? JSON.stringify({
              evidenceId: call.evidence.evidenceId,
              n: (call.evidence.result as { n: number }).n,
            })
          : JSON.stringify({ error: call.error });
      },
    });
    const mentionsTruth = out.final.text.includes(String(truth));
    return {
      ok: out.toolCallCount >= 1 && mentionsTruth,
      detail: `toolCalls=${out.toolCallCount} truthN=${truth} answer=${JSON.stringify(out.final.text.slice(0, 90))}`,
    };
  });
}

// 4. Fixtures: record a live call, then replay it with the network unreachable (bad base URL).
await check("fixtures record then replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orion-fixtures-"));
  const store = new FileFixtureStore(directory);
  const request: ChatRequest = {
    label: "live:fixture",
    target: "spark",
    reasoningEffort: "minimal",
    messages: [{ role: "user", content: "Reply with the single word PONG." }],
  };
  const recorded = await createModelClient(env, { logger, fixtures: store, fixtureMode: "record" }).chat(
    request,
  );
  // Replay with a client whose API URL is unreachable: success proves no network call happened.
  const offlineEnv = { ...env, META_API_BASE_URL: "http://127.0.0.1:9", MODEL_API_KEY: undefined };
  const replayed = await createModelClient(offlineEnv, {
    logger,
    fixtures: store,
    fixtureMode: "replay",
  }).chat(request);
  return {
    ok: replayed.fromFixture && replayed.text === recorded.text,
    detail: `recorded=${JSON.stringify(recorded.text.slice(0, 20))} replayed=${JSON.stringify(replayed.text.slice(0, 20))} fromFixture=${replayed.fromFixture}`,
  };
});

for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(30)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

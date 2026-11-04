/**
 * record-demo-fixtures.ts: record the answers the offline demo replays.
 *
 * A build with USE_FIXTURES=true never calls the model: it replays recorded Muse Spark answers keyed by the exact
 * request. This script makes the recordings for every one-click example in the app, by driving the same server
 * handlers the browser reaches, against the LIVE model with RECORD_FIXTURES=true:
 *
 *   1. Your story: the example story (and a check that it reads into the person the app opens on)
 *   2. What if: each example sentence, from the starting limits
 *   3. Plan: the starting limits, and the limits each example leads to (so "try an example, then build the plan" works)
 *   4. Privacy: the example text checked by Muse Spark
 *
 * Costs a few cents and takes a few minutes. Run: RECORD_FIXTURES=true npm run record:demo   (key exported)
 * The recordings are plain JSON in src/fixtures and are committed, so anyone can replay them without a key.
 */
import { handleIntake, handlePlan, handlePrivacy, handleWhatIf } from "../src/lib/api/handlers";
import { IntakeRequest, PlanRequest, PrivacyRequest, WhatIfRequest } from "../src/lib/api/schemas";
import type { Services } from "../src/lib/api/services";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";
import { DEMO_BIO, DEMO_STORY, WHATIF_EXAMPLES, exampleMessage } from "../src/ui/demo";
import { formFromDraft, personFromForm } from "../src/ui/intake";
import { normalise } from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";

const env = getEnv();
if (!env.RECORD_FIXTURES)
  throw new Error("Set RECORD_FIXTURES=true (and a MODEL_API_KEY): this script records live answers.");
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });
const services = { client } as unknown as Services;
const quiet = (): void => undefined;
const seconds = (since: number): string => `${((Date.now() - since) / 1000).toFixed(1)} s`;

let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
};

// 1. Your story
console.log("\n[1] Your story");
let started = Date.now();
const intake = await handleIntake(services, IntakeRequest.parse({ text: DEMO_STORY }), quiet);
console.log(`    status ${intake.status} in ${seconds(started)}`);
const confirmed = personFromForm(formFromDraft(intake.draft));
check(intake.status === "complete", "the example story reads as complete");
check(confirmed.ok, "the form it fills can be confirmed");
if (confirmed.ok) {
  check(
    JSON.stringify(confirmed.person) === JSON.stringify(SAMPLE_PERSON),
    "and it is exactly the person the app opens on",
  );
  if (JSON.stringify(confirmed.person) !== JSON.stringify(SAMPLE_PERSON))
    console.log(JSON.stringify(confirmed.person));
}

// 2. What if, and 3. Plan for each resulting set of limits
const planFor = async (label: string, constraints: object): Promise<void> => {
  started = Date.now();
  const body = PlanRequest.parse({ profile: SAMPLE_PERSON.profile, goal: SAMPLE_PERSON.goal, constraints });
  const run = await handlePlan(services, body, quiet);
  console.log(
    `    plan for ${label}: ${run.status} after ${run.revisions} revision(s) in ${seconds(started)}`,
  );
};

console.log("\n[2] What if");
const limits: { label: string; constraints: object }[] = [
  { label: "the starting limits", constraints: SAMPLE_PERSON.constraints },
];
for (const example of WHATIF_EXAMPLES) {
  started = Date.now();
  const message = exampleMessage(example);
  const run = await handleWhatIf(
    services,
    WhatIfRequest.parse({
      message,
      current: SAMPLE_PERSON.constraints,
      profile: SAMPLE_PERSON.profile,
      goal: SAMPLE_PERSON.goal,
    }),
    quiet,
  );
  console.log(
    `    "${message}": ${run.interpretation.status}, ${run.narration.source} narration, in ${seconds(started)}`,
  );
  check(run.interpretation.applied.length > 0, `"${message}" changes something`);
  limits.push({ label: `"${message}"`, constraints: normalise(run.interpretation.next) });
}

console.log("\n[3] Plan");
for (const { label, constraints } of limits) await planFor(label, constraints);

// 4. Privacy
console.log("\n[4] Privacy");
started = Date.now();
const privacy = await handlePrivacy(
  services,
  PrivacyRequest.parse({
    profile: SAMPLE_PERSON.profile,
    goal: SAMPLE_PERSON.goal,
    k: 10,
    text: DEMO_BIO,
    useModel: true,
  }),
  quiet,
);
console.log(
  `    ${privacy.risk} risk, ${privacy.findings.length} findings, text check ${privacy.textCheck}, in ${seconds(started)}`,
);
check(privacy.textCheck === "done", "Muse Spark read the example text");

console.log(
  failures === 0 ? "\nAll flows recorded." : `\n${failures} check(s) failed: do not commit these recordings.`,
);
process.exit(failures === 0 ? 0 : 1);

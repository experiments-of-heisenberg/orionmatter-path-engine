/**
 * live-intake-check.ts: evaluate the Intake agent on the REAL model with labeled cases, plus one
 * screenshot. Failures are printed with reasons, not hidden: they say what to fix.
 *
 * Costs a few cents. Run: npm run live:intake   (both API keys exported; see .env.example)
 * Optional: REPEAT=3 for consistency.
 */
import { readFileSync } from "node:fs";
import { checkIntake } from "../evals/intake/check";
import { INTAKE_CASES } from "../evals/intake/cases";
import { getEnv } from "../src/lib/env";
import { runIntake, type IntakeResult } from "../src/lib/intake";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";

const env = getEnv();
const secrets = [env.MODEL_API_KEY, env.BASETEN_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });
const repeat = Number(process.env.REPEAT ?? 1);

const byCategory = new Map<string, { pass: number; total: number }>();
const failures: string[] = [];
const latencies: number[] = [];

for (const evalCase of INTAKE_CASES) {
  for (let run = 1; run <= repeat; run++) {
    const started = Date.now();
    let problems: string[];
    try {
      const first = evalCase.firstTurn
        ? await runIntake({ client }, { text: evalCase.firstTurn })
        : undefined;
      const result: IntakeResult = await runIntake(
        { client },
        {
          text: evalCase.text,
          ...(first ? { previous: { draft: first.draft, provenance: first.provenance } } : {}),
        },
      );
      problems = checkIntake(evalCase, result);
    } catch (error) {
      problems = [`threw ${error instanceof Error ? error.message : String(error)}`];
    }
    const ms = Date.now() - started;
    latencies.push(ms);
    const tally = byCategory.get(evalCase.category) ?? { pass: 0, total: 0 };
    tally.total++;
    if (problems.length === 0) tally.pass++;
    else failures.push(`[${evalCase.category}] ${evalCase.id} (run ${run}): ${problems.join("; ")}`);
    byCategory.set(evalCase.category, tally);
    console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${evalCase.id.padEnd(30)} ${ms}ms`);
  }
}

// ---- one screenshot: a rendered resume with an email and phone number printed on it ----
const imageUrl = `data:image/png;base64,${readFileSync("evals/fixtures/resume-sample.png").toString("base64")}`;
const started = Date.now();
const shot = await runIntake({ client }, { imageDataUrl: imageUrl });
console.log(`\nSCREENSHOT (${Date.now() - started} ms): status ${shot.status}`);
console.log(
  JSON.stringify(
    {
      draft: shot.draft,
      provenance: Object.fromEntries(Object.entries(shot.provenance).map(([k, v]) => [k, v.source])),
      discarded: shot.discarded,
    },
    null,
    1,
  ),
);

console.log("\nBy category:");
let pass = 0;
let total = 0;
for (const [category, t] of byCategory) {
  console.log(`  ${category.padEnd(10)} ${t.pass}/${t.total}`);
  pass += t.pass;
  total += t.total;
}
latencies.sort((a, b) => a - b);
const pick = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
console.log(
  `\nOverall: ${pass}/${total} passed | latency median ${pick(0.5)}ms, p90 ${pick(0.9)}ms, max ${latencies[latencies.length - 1] ?? 0}ms`,
);
if (failures.length > 0) console.log("\nFailures:\n" + failures.map((f) => "  " + f).join("\n"));

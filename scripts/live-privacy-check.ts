/**
 * live-privacy-check.ts: evaluate the Privacy Guard's model half on the REAL model with labeled
 * stories. Failures are printed with reasons, not hidden.
 *
 * Costs a few cents. Run: npm run live:privacy   (MODEL_API_KEY exported; see .env.example)
 * Optional: REPEAT=3 for consistency.
 */
import { checkPrivacy } from "../evals/privacy/check";
import { PRIVACY_CASES } from "../evals/privacy/cases";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";
import { assessPrivacy } from "../src/lib/privacy";
import { goal, profile } from "./lib/sampleInput";

const env = getEnv();
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });
const repeat = Number(process.env.REPEAT ?? 1);

const byCategory = new Map<string, { pass: number; total: number }>();
const failures: string[] = [];
const latencies: number[] = [];

for (const evalCase of PRIVACY_CASES) {
  for (let run = 1; run <= repeat; run++) {
    const started = Date.now();
    let problems: string[];
    try {
      const result = await assessPrivacy({ client }, { profile, goal, text: evalCase.text });
      problems = checkPrivacy(evalCase, result);
      if (run === 1)
        console.log(
          `   ${evalCase.id}: ${result.risk} | ${result.findings.map((f) => `${f.source}:${f.category}:"${f.quote}"`).join(", ") || "no findings"}`,
        );
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
    console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${evalCase.id.padEnd(28)} ${ms}ms`);
  }
}

console.log("\nBy category:");
let pass = 0;
let total = 0;
for (const [category, t] of byCategory) {
  console.log(`  ${category.padEnd(12)} ${t.pass}/${t.total}`);
  pass += t.pass;
  total += t.total;
}
latencies.sort((a, b) => a - b);
const pick = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
console.log(
  `\nOverall: ${pass}/${total} passed | latency median ${pick(0.5)}ms, p90 ${pick(0.9)}ms, max ${latencies[latencies.length - 1] ?? 0}ms`,
);
if (failures.length > 0) console.log("\nFailures:\n" + failures.map((f) => "  " + f).join("\n"));

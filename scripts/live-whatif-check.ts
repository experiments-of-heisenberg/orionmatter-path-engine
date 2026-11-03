/**
 * live-whatif-check.ts: evaluate the What-if interpreter on REAL models with labeled cases.
 *
 * Unit tests use a scripted model. This measures how well the real model translates real
 * sentences: per-category pass rate, failures with reasons, and latency. Failures are shown,
 * not hidden: they tell us what to fix in the prompt or the guards.
 *
 * Costs a few cents. Run: npm run live:whatif   (with both API keys exported; see .env.example)
 * Optional: REPEAT=3 to run each case several times and measure consistency.
 */
import { checkInterpretation, startingConstraints } from "../evals/whatif/check";
import { WHATIF_CASES } from "../evals/whatif/cases";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";
import { goal, profile } from "./lib/sampleInput";
import { interpretWhatIf } from "../src/lib/whatif";

const env = getEnv();
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });
const repeat = Number(process.env.REPEAT ?? 1);

const byCategory = new Map<string, { pass: number; total: number }>();
const failures: string[] = [];
const latencies: number[] = [];

for (const evalCase of WHATIF_CASES) {
  for (let run = 1; run <= repeat; run++) {
    const started = Date.now();
    let problems: string[];
    try {
      const result = await interpretWhatIf(
        { client },
        {
          message: evalCase.message,
          current: startingConstraints(evalCase),
          profile,
          goal,
          history: evalCase.history,
        },
      );
      problems = checkInterpretation(evalCase, result);
    } catch (error) {
      problems = [
        `threw ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : String(error)}`,
      ];
    }
    latencies.push(Date.now() - started);
    const tally = byCategory.get(evalCase.category) ?? { pass: 0, total: 0 };
    tally.total++;
    if (problems.length === 0) tally.pass++;
    else
      failures.push(
        `[${evalCase.category}] ${evalCase.id}${repeat > 1 ? ` (run ${run})` : ""}: "${evalCase.message}"\n      ${problems.join("\n      ")}`,
      );
    byCategory.set(evalCase.category, tally);
    console.log(
      `${problems.length === 0 ? "PASS" : "FAIL"}  ${evalCase.id.padEnd(30)} ${String(Date.now() - started).padStart(5)}ms`,
    );
  }
}

const sorted = [...latencies].sort((a, b) => a - b);
const total = [...byCategory.values()].reduce(
  (sum, t) => ({ pass: sum.pass + t.pass, total: sum.total + t.total }),
  { pass: 0, total: 0 },
);
console.log("\nBy category:");
for (const [category, tally] of byCategory)
  console.log(`  ${category.padEnd(14)} ${tally.pass}/${tally.total}`);
console.log(
  `\nOverall: ${total.pass}/${total.total} passed | latency median ${sorted[Math.floor(sorted.length / 2)]}ms, p90 ${sorted[Math.floor(sorted.length * 0.9)]}ms, max ${sorted.at(-1)}ms`,
);
if (failures.length > 0) console.log(`\nFailures:\n${failures.map((f) => `  ${f}`).join("\n")}`);

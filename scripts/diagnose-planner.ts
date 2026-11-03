/**
 * diagnose-planner.ts: where does a Planner run spend its time, and why does it repair?
 *
 * Runs one scenario with per-call timing from the client's log lines, and prints the reason
 * the first composition draft was rejected (if it was). Used to tune prompts and settings.
 * Run: npm run diagnose:planner   (with both API keys exported; see .env.example)
 */
import { runPlanner } from "../src/lib/agents";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient, type ReasoningEffort } from "../src/lib/model";
import { Constraints, Goal, Profile } from "../src/lib/schemas";

const env = getEnv();
/** The fields of the client's log lines that this script reads. */
interface LogLine {
  message: string;
  label?: string;
  latencyMs?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  attempts?: number;
  finishReason?: string;
}
const lines: LogLine[] = [];
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const logger = createLogger({
  level: "info",
  secrets,
  sink: (line) => lines.push(JSON.parse(line) as LogLine),
});
const client = createModelClient(env, { logger });

const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go", "kubernetes"],
  region: "IN-south",
});
const compose = (process.env.COMPOSE_EFFORT ?? "low") as ReasoningEffort;
console.log(`compose reasoning effort: ${compose}`);
const started = Date.now();
const out = await runPlanner(
  { client, reasoning: { compose } },
  {
    profile,
    goal: Goal.parse({ targetLevel: "L6", label: "Staff Engineer" }),
    constraints: Constraints.parse({}),
  },
);

console.log(`total ${((Date.now() - started) / 1000).toFixed(1)}s | repaired=${out.repaired}`);
console.log("per-call timing:");
const interesting = ["model.call", "model.escalate_budget", "model.retry"];
for (const l of lines.filter((x) => interesting.includes(x.message))) {
  console.log(
    `  ${l.message.padEnd(22)} ${(l.label ?? "").padEnd(26)} ${String(l.latencyMs ?? "").padStart(6)}ms` +
      `  completion=${l.completionTokens ?? "-"} reasoning=${l.reasoningTokens ?? "-"} attempts=${l.attempts ?? "-"} finish=${l.finishReason ?? "-"}`,
  );
}
if (process.env.DUMP_PLAN) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.DUMP_PLAN, JSON.stringify(out.plan, null, 2));
  console.log(`\nplan written to ${process.env.DUMP_PLAN}`);
}
if (out.repairReason) console.log(`\nFirst draft rejected because:\n${out.repairReason}`);

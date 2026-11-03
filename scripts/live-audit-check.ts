/**
 * live-audit-check.ts: run the full pipeline (Planner, Skeptic, revisions) on REAL models.
 *
 * Unit tests use scripted models. This answers the questions only live runs can: how often
 * does the Skeptic really reject a plan, what for, do revisions resolve it, and how long
 * does it all take? Nothing is staged: every rejection reported here came from a real run.
 *
 * Costs a few cents per scenario. Run: bash with_keys.sh npx tsx scripts/live-audit-check.ts
 * Optional: SCENARIOS=1,3 to run a subset; DUMP_DIR=/tmp/audit to save each plan as JSON.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "../src/lib/agents";
import type { EngineInput } from "../src/lib/engine";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";
import { runPlan } from "../src/lib/orchestrator";
import { Constraints, Goal, Profile } from "../src/lib/schemas";

const env = getEnv();
const secrets = [env.MODEL_API_KEY, env.BASETEN_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });

const person = (overrides: Record<string, unknown>) =>
  Profile.parse({
    roleFamily: "backend",
    level: "L5",
    yearsExperience: 7,
    stack: ["go", "kubernetes"],
    region: "IN-south",
    ...overrides,
  });
const staff = Goal.parse({ targetLevel: "L6", label: "Staff Engineer" });

const scenarios: { name: string; input: EngineInput }[] = [
  {
    name: "backend L5 to Staff",
    input: { profile: person({}), goal: staff, constraints: Constraints.parse({}) },
  },
  {
    name: "backend L5 to Staff, remote and no relocation",
    input: {
      profile: person({}),
      goal: staff,
      constraints: Constraints.parse({ remote: true, noRelocation: true }),
    },
  },
  {
    name: "ml L5 to Staff (thin pivot)",
    input: { profile: person({ roleFamily: "ml" }), goal: staff, constraints: Constraints.parse({}) },
  },
  {
    name: "embedded L4 to Staff (thin pivot)",
    input: {
      profile: person({ roleFamily: "embedded", level: "L4", yearsExperience: 4 }),
      goal: staff,
      constraints: Constraints.parse({}),
    },
  },
  {
    name: "backend L5 to Engineering Manager",
    input: {
      profile: person({}),
      goal: Goal.parse({ targetLevel: "EM1", label: "Engineering Manager" }),
      constraints: Constraints.parse({}),
    },
  },
  {
    name: "sre L4 to Staff, low risk, wants Rust",
    input: {
      profile: person({ roleFamily: "sre", level: "L4", yearsExperience: 4, stack: ["python", "terraform"] }),
      goal: staff,
      constraints: Constraints.parse({ riskTolerance: "low", addSkills: ["rust"] }),
    },
  },
];

const wanted = process.env.SCENARIOS?.split(",").map(Number);
let unresolved = 0;
let revised = 0;
let ran = 0;

for (const [index, scenario] of scenarios.entries()) {
  if (wanted && !wanted.includes(index + 1)) continue;
  ran++;
  console.log(`\n=== ${index + 1}. ${scenario.name}`);
  const events: AgentEvent[] = [];
  const started = Date.now();
  try {
    const out = await runPlan({ client, emit: (e) => events.push(e) }, scenario.input);
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    if (out.revisions > 0) revised++;
    if (out.status === "unresolved") unresolved++;
    console.log(
      `${out.status.toUpperCase()} in ${seconds}s | revisions ${out.revisions} | engine filled in: ${out.planner.filledIn.join(", ") || "nothing"}`,
    );
    out.verdicts.forEach((verdict, round) => {
      const label = round === 0 ? "first plan" : `after revision ${round}`;
      console.log(
        `  audit ${round} (${label}): ${verdict.approved ? "approved" : `${verdict.rejections.length} rejection(s)`}`,
      );
      for (const rejection of verdict.rejections.slice(0, 5)) {
        const where = rejection.routeIndex < 0 ? "plan" : ["climb", "jump", "pivot"][rejection.routeIndex];
        console.log(
          `    [${rejection.source}/${rejection.code}] ${where}: ${rejection.reason.slice(0, 150)}`,
        );
        console.log(`      text: "${rejection.claimText.slice(0, 90)}"`);
      }
      for (const note of verdict.notes.filter((n) => !n.startsWith("Verifier checked")).slice(0, 2))
        console.log(`    note: ${note.slice(0, 140)}`);
    });
    if (process.env.DUMP_DIR) {
      mkdirSync(process.env.DUMP_DIR, { recursive: true });
      writeFileSync(
        join(process.env.DUMP_DIR, `scenario-${index + 1}.json`),
        JSON.stringify({ status: out.status, verdicts: out.verdicts, plan: out.plan }, null, 2),
      );
    }
  } catch (error) {
    unresolved++;
    console.log(
      `FAILED: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : String(error)}`,
    );
  }
}
console.log(`\nSummary: ${ran} scenario(s), ${revised} needed revision, ${unresolved} unresolved or failed.`);

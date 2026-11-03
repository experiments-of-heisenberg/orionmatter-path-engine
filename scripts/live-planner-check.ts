/**
 * live-planner-check.ts: run the Planner against the REAL models and report what happened.
 *
 * Unit tests prove the Planner's logic with a scripted model. This shows how the real
 * model behaves: did it call the tools, did it need engine top-ups, did composition need
 * a repair, and are the numbers in its claims consistent with the evidence ledger?
 * (The last part previews what the Skeptic will enforce in Part 5.)
 *
 * Scenarios: a well-supported plan (backend L5 to Staff) and a thin one (ML pivot).
 * Costs a few cents. Run: npm run live:planner   (with both API keys exported; see .env.example)
 */
import { runPlanner, type AgentEvent } from "../src/lib/agents";
import type { EngineInput } from "../src/lib/engine";
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";
import { Constraints, Goal, Profile } from "../src/lib/schemas";
import type { EvidenceLedger } from "../src/lib/tools";

const env = getEnv();
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });

const base = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go", "kubernetes"],
  region: "IN-south",
});
const goal = Goal.parse({ targetLevel: "L6", label: "Staff Engineer" });
const scenarios: Record<string, EngineInput> = {
  "backend L5 to Staff (well supported)": { profile: base, goal, constraints: Constraints.parse({}) },
  "ml L5 to Staff (thin pivot)": {
    profile: Profile.parse({ ...base, roleFamily: "ml" }),
    goal,
    constraints: Constraints.parse({}),
  },
};

/** Compare the numbers in each claim with what the ledger recorded. Returns problems found. */
function claimProblems(
  ledger: EvidenceLedger,
  plan: Awaited<ReturnType<typeof runPlanner>>["plan"],
): string[] {
  const problems: string[] = [];
  for (const route of plan.routes) {
    route.steps.forEach((step, stepIndex) => {
      for (const claim of step.whyItWorks) {
        const where = `${route.archetype} step ${stepIndex + 1}`;
        for (const id of claim.evidenceIds) {
          const evidence = ledger.get(id);
          if (!evidence) problems.push(`${where}: cites unknown evidence ${id}`);
          else if (evidence.tool === "pathStats" && evidence.result.n !== claim.n)
            problems.push(`${where}: claim n=${claim.n} but ${id} has n=${evidence.result.n}`);
        }
        if (claim.range) {
          const [lo, hi] = claim.range;
          const m = route.metrics;
          const matchesMonths = m.monthsToGoal?.[0] === lo && m.monthsToGoal?.[1] === hi;
          const matchesRate = m.reachedRate[0] === lo && m.reachedRate[1] === hi;
          if (!matchesMonths && !matchesRate)
            problems.push(`${where}: range [${lo}, ${hi}] matches neither months nor success rate`);
        }
        if (/\b(will|guarantee|guaranteed|certain|definitely)\b/i.test(claim.text))
          problems.push(`${where}: overclaiming language in "${claim.text.slice(0, 60)}"`);
      }
      const [start, end] = step.monthWindow;
      const upper = route.metrics.monthsToGoal?.[1] ?? 0;
      if (end > upper || start > end)
        problems.push(
          `${route.archetype} step ${stepIndex + 1}: monthWindow [${start}, ${end}] outside [0, ${upper}]`,
        );
    });
  }
  return problems;
}

let failures = 0;
for (const [name, input] of Object.entries(scenarios)) {
  console.log(`\n=== ${name}`);
  const events: AgentEvent[] = [];
  const started = Date.now();
  try {
    const out = await runPlanner({ client, emit: (e) => events.push(e) }, input);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `time ${seconds}s | agent tool calls ${out.agentToolCalls} | engine filled in: ${out.filledIn.join(", ") || "nothing"} | repaired: ${out.repaired}`,
    );
    console.log("trace:");
    for (const e of events) if (e.type === "tool_result") console.log(`  [${e.by}] ${e.summary}`);
    for (const route of out.plan.routes) {
      const m = route.metrics;
      console.log(
        `${route.archetype.padEnd(6)} n=${String(m.evidenceN).padEnd(3)} months=${JSON.stringify(m.monthsToGoal)} reached=${JSON.stringify(m.reachedRate)} thin=${route.evidenceThin} steps=${route.steps.length}`,
      );
      console.log(`       "${route.summary.slice(0, 140)}"`);
    }
    const problems = claimProblems(out.ledger, out.plan);
    console.log(
      `claim consistency: ${problems.length === 0 ? "no problems" : problems.length + " problem(s)"}`,
    );
    for (const p of problems.slice(0, 8)) console.log(`  - ${p}`);
    if (problems.length > 0) failures++;
  } catch (error) {
    failures++;
    console.log(
      `FAILED: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : String(error)}`,
    );
  }
}
console.log(
  `\n${failures === 0 ? "all scenarios clean" : failures + " scenario(s) had problems (informational for Part 5)"}`,
);

/**
 * live-whatif-run.ts: run complete What-if turns on the REAL model and report the narrator.
 *
 * Measures what matters for the demo: does the narrator's output pass the grounding checks
 * (source "model") or fall back to the template, how often did a first attempt get rejected,
 * and how long a full turn takes. Prints the narrations so a human can judge their quality.
 *
 * Costs a few cents. Run: npm run live:whatif-run   (both API keys exported)
 * Optional: REPEAT=3 to measure consistency.
 */
import { getEnv } from "../src/lib/env";
import { createLogger } from "../src/lib/log";
import { createModelClient } from "../src/lib/model";
import { Constraints } from "../src/lib/schemas";
import type { AgentEvent } from "../src/lib/agents";
import { runWhatIf } from "../src/lib/whatif";
import { goal, profile } from "./lib/sampleInput";

const env = getEnv();
const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
const client = createModelClient(env, { logger: createLogger({ level: "warn", secrets }) });
const repeat = Number(process.env.REPEAT ?? 1);

const TURNS: { message: string; current?: object }[] = [
  { message: "What if I need to reach it within 2 years?" },
  { message: "I only want to consider roles that pay B5 or above" },
  { message: "what if I learn Rust and Go?" },
  { message: "remote only please" },
  { message: "within 3 years, and I want to play it safe" },
  { message: "what if I wanted it within a year?" },
  { message: "forget the time limit", current: { maxMonths: 24 } },
];

let model = 0;
let template = 0;
let retried = 0;
const latencies: number[] = [];
for (const turn of TURNS) {
  for (let run = 1; run <= repeat; run++) {
    const notes: string[] = [];
    const started = Date.now();
    const out = await runWhatIf(
      { client, emit: (event: AgentEvent) => event.type === "note" && notes.push(event.message) },
      { message: turn.message, current: Constraints.parse(turn.current ?? {}), profile, goal },
    );
    const ms = Date.now() - started;
    latencies.push(ms);
    if (out.narration.source === "model") model++;
    else if (out.diff.facts.length > 0) template++;
    if (notes.some((note) => note.includes("asking once for a fix"))) retried++;
    if (run === 1) {
      console.log(
        `\n=== "${turn.message}"  (${ms} ms, ${out.narration.source}, ${out.diff.facts.length} facts)`,
      );
      console.log(
        `status: ${out.interpretation.status}; applied: ${out.interpretation.applied.map((a) => `${a.label} ${a.from} -> ${a.to}`).join("; ") || "none"}`,
      );
      console.log(`headline: ${out.narration.headline}`);
      for (const point of out.narration.points)
        console.log(`  - ${point.text}  [${point.factIds.join(",")}]`);
      for (const note of notes) console.log(`  note: ${note}`);
    }
  }
}
latencies.sort((a, b) => a - b);
const pick = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
console.log(`\nnarration source: model ${model}, template ${template}; first attempt rejected ${retried}`);
console.log(
  `full turn latency: median ${pick(0.5)} ms, p90 ${pick(0.9)} ms, max ${latencies[latencies.length - 1] ?? 0} ms`,
);

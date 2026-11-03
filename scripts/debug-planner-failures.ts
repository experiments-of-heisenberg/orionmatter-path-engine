/**
 * debug-planner-failures.ts: run the real Planner repeatedly and capture the raw reply of any
 * run whose composition fails validation, to find out what the model actually sent.
 * The reply is synthetic-data only (no user data), so printing its head and tail is safe here.
 * Run: ATTEMPTS=8 npm run debug:failures   (both API keys exported)
 */
import { writeFileSync } from "node:fs";
import { runPlanner } from "../src/lib/agents";
import { getEnv } from "../src/lib/env";
import { createModelClient, extractJson, ModelParseError, type ModelClient } from "../src/lib/model";
import { Constraints, Goal, Profile } from "../src/lib/schemas";

const live = createModelClient(getEnv());
/** Wraps the client so EVERY compose reply that is not parseable JSON is printed, even if a repair later rescues the run. */
const client: ModelClient = {
  async chat(request) {
    const result = await live.chat(request);
    if (request.label.startsWith("planner:compose") || request.label.startsWith("planner:revise")) {
      try {
        extractJson(result.text);
      } catch {
        const file = `/tmp/failing-reply-${Date.now()}.txt`;
        writeFileSync(file, result.text);
        console.log(`   saved full reply to ${file}`);
        console.log(
          `   [unparseable ${request.label}] finish=${result.finishReason} completion=${result.usage.completionTokens} reasoning=${result.usage.reasoningTokens} len=${result.text.length}\n` +
            `     head: ${JSON.stringify(result.text.slice(0, 220))}\n     tail: ${JSON.stringify(result.text.slice(-220))}`,
        );
      }
    }
    return result;
  },
};
const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go", "kubernetes"],
  region: "IN-south",
});
const input = {
  profile,
  goal: Goal.parse({ targetLevel: "L6", label: "Staff Engineer" }),
  constraints: Constraints.parse({}),
};

const attempts = Number(process.env.ATTEMPTS ?? 8);
let failures = 0;
for (let i = 1; i <= attempts; i++) {
  const started = Date.now();
  try {
    const out = await runPlanner({ client }, input);
    console.log(
      `#${i} ok in ${((Date.now() - started) / 1000).toFixed(0)}s repaired=${out.repaired} recovered=${out.recovered}${out.repairReason ? ` (first draft: ${out.repairReason.slice(0, 80)})` : ""}`,
    );
  } catch (error) {
    failures++;
    if (error instanceof ModelParseError) {
      console.log(`#${i} FAILED validation: ${error.issues.slice(0, 120)}`);
      console.log(
        `   lastText length=${error.lastText.length}\n   head: ${JSON.stringify(error.lastText.slice(0, 200))}\n   tail: ${JSON.stringify(error.lastText.slice(-200))}`,
      );
    } else {
      console.log(
        `#${i} FAILED: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : String(error)}`,
      );
    }
  }
}
console.log(`\n${failures}/${attempts} runs failed`);

/**
 * debug-compose.ts: repeat the Planner's composition call and show what comes back when it fails.
 *
 * Used to investigate unparseable replies: prints finish reason, token usage and the head and
 * tail of the raw text for each failing attempt. Run: npm run debug:compose   (both API keys exported)
 */
import { gatherEvidence } from "../src/lib/engine";
import { COMPOSE_SYSTEM_PROMPT, composeUserMessage } from "../src/lib/agents/plannerPrompts";
import { getEnv } from "../src/lib/env";
import { createModelClient, extractJson, JsonExtractError } from "../src/lib/model";
import { Constraints, Goal, Profile } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { z } from "zod";
import { PlanDraft } from "../src/lib/engine";

const client = createModelClient(getEnv());
const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go", "kubernetes"],
  region: "IN-south",
});
const sheet = gatherEvidence(new EvidenceLedger(), {
  profile,
  goal: Goal.parse({ targetLevel: "L6", label: "Staff Engineer" }),
  constraints: Constraints.parse({}),
});
const schemaNote = `Respond with ONLY a single JSON value that matches this JSON Schema. No prose, no markdown fences.\n${JSON.stringify(z.toJSONSchema(PlanDraft))}`;

const attempts = Number(process.env.ATTEMPTS ?? 6);
let failures = 0;
for (let i = 1; i <= attempts; i++) {
  const result = await client.chat({
    label: `debug:compose:${i}`,
    target: "spark",
    reasoningEffort: "minimal",
    maxCompletionTokens: 8000,
    ...(process.env.TEMP ? { temperature: Number(process.env.TEMP) } : {}),
    messages: [
      { role: "system", content: COMPOSE_SYSTEM_PROMPT },
      { role: "user", content: composeUserMessage(sheet) },
      { role: "system", content: schemaNote },
    ],
  });
  let verdict = "valid JSON + schema";
  try {
    const parsed = PlanDraft.safeParse(extractJson(result.text));
    if (!parsed.success)
      verdict = `JSON ok but schema failed: ${parsed.error.issues[0]?.message} @ ${parsed.error.issues[0]?.path.join(".")}`;
  } catch (error) {
    verdict = error instanceof JsonExtractError ? "NO PARSEABLE JSON" : "error";
  }
  const bad = verdict !== "valid JSON + schema";
  if (bad) failures++;
  console.log(
    `#${i} finish=${result.finishReason} completion=${result.usage.completionTokens} reasoning=${result.usage.reasoningTokens} textLen=${result.text.length} -> ${verdict}`,
  );
  if (bad)
    console.log(
      `   head: ${JSON.stringify(result.text.slice(0, 160))}\n   tail: ${JSON.stringify(result.text.slice(-160))}`,
    );
}
console.log(`\ntemperature=${process.env.TEMP ?? "default"}: ${failures}/${attempts} attempts failed`);

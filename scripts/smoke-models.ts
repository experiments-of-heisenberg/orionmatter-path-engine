/**
 * smoke-models.ts — live connectivity and capability probe for the two Muse models.
 *
 * Purpose: the agent code depends on behaviours (tool calling, JSON output, image
 * input, reasoning control) that must be confirmed against the real APIs rather
 * than assumed from docs. Run this once, read the report, and adapt the model
 * client (Part 3) to what actually works.
 *
 * Targets:
 *   - "spark": Muse Spark on the Meta Model API  (MODEL_API_KEY)
 *   - "open" : Muse Spark Open on Baseten        (BASETEN_API_KEY)
 *
 * Output: a JSON-ish report on stdout. Key values are never printed.
 * Run:    npx tsx scripts/smoke-models.ts
 */

/**
 * Token budget per probe. Muse Spark is a reasoning model and its
 * `max_completion_tokens` INCLUDES hidden reasoning tokens, so a small budget can be
 * fully consumed by reasoning and yield an empty answer (observed with 200).
 */
const BUDGET = 3000;

import { makePngDataUrl } from "./lib/testImage";

type Target = { name: string; baseUrl: string; key: string; model: string };

const targets: Target[] = [
  {
    name: "spark",
    baseUrl: "https://api.meta.ai/v1",
    key: process.env.MODEL_API_KEY ?? "",
    model: process.env.META_MODEL_SPARK ?? "muse-spark-1.3",
  },
  {
    name: "open",
    baseUrl: "https://inference.baseten.co/v1",
    key: process.env.BASETEN_API_KEY ?? "",
    model: process.env.OPEN_MODEL_ID ?? "meta-models/muse-spark-open-1026",
  },
];

/** One probe result: pass/fail plus a short human-readable note. */
type Probe = { probe: string; ok: boolean; note: string; ms: number };

/** POST a chat completion; returns parsed JSON or an error description. */
async function chat(t: Target, body: Record<string, unknown>) {
  const res = await fetch(`${t.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: t.model, ...body }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep raw text */ }
  return { status: res.status, json, raw: text.slice(0, 300) };
}

/** Time and run a probe, converting thrown errors into a failed result. */
async function run(probe: string, fn: () => Promise<{ ok: boolean; note: string }>): Promise<Probe> {
  const start = Date.now();
  try {
    const r = await fn();
    return { probe, ...r, ms: Date.now() - start };
  } catch (e) {
    return { probe, ok: false, note: `threw: ${(e as Error).message}`, ms: Date.now() - start };
  }
}

const msg = (r: any) => r.json?.choices?.[0]?.message;
/** True when the reply carries non-empty text content. */
const hasText = (r: any) => typeof msg(r)?.content === "string" && msg(r).content.trim().length > 0;
/** Reasoning tokens reported in usage, useful for sizing budgets. */
const reasoningTokens = (r: any) => r.json?.usage?.completion_tokens_details?.reasoning_tokens ?? "n/a";

const RED_PNG = makePngDataUrl(8, 8, [255, 0, 0]);

async function probeTarget(t: Target): Promise<Probe[]> {
  const out: Probe[] = [];

  out.push(await run("plain reply", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: "Reply with the single word OK." }], max_completion_tokens: BUDGET });
    const text = msg(r)?.content ?? "";
    return { ok: r.status === 200 && /ok/i.test(text), note: `http ${r.status}; reply=${JSON.stringify(text).slice(0, 80)}; reasoning_tokens=${reasoningTokens(r)}` };
  }));

  out.push(await run("system role", async () => {
    const r = await chat(t, { messages: [{ role: "system", content: "Answer in one word." }, { role: "user", content: "Capital of France?" }], max_completion_tokens: BUDGET });
    return { ok: r.status === 200 && hasText(r), note: `http ${r.status}; ${r.status === 200 ? JSON.stringify(msg(r)?.content).slice(0, 60) : r.raw}; reasoning_tokens=${reasoningTokens(r)}` };
  }));

  out.push(await run("developer role", async () => {
    const r = await chat(t, { messages: [{ role: "developer", content: "Answer in one word." }, { role: "user", content: "Capital of France?" }], max_completion_tokens: BUDGET });
    return { ok: r.status === 200 && hasText(r), note: `http ${r.status}; ${r.status === 200 ? JSON.stringify(msg(r)?.content).slice(0, 60) : r.raw}; reasoning_tokens=${reasoningTokens(r)}` };
  }));

  out.push(await run("tool calling", async () => {
    const r = await chat(t, {
      messages: [{ role: "user", content: "Use the get_cohort_size tool for role 'backend'." }],
      tools: [{ type: "function", function: { name: "get_cohort_size", description: "Number of engineers in a role family.", parameters: { type: "object", properties: { role: { type: "string" } }, required: ["role"] } } }],
      tool_choice: "auto",
      max_completion_tokens: BUDGET,
    });
    const calls = msg(r)?.tool_calls;
    return { ok: r.status === 200 && Array.isArray(calls) && calls.length > 0, note: `http ${r.status}; tool_calls=${JSON.stringify(calls ?? null).slice(0, 160)}; finish=${r.json?.choices?.[0]?.finish_reason}` };
  }));

  out.push(await run("json via prompt", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: 'Return ONLY a JSON object {"level":"L5","years":7} with no prose.' }], max_completion_tokens: BUDGET });
    const text = (msg(r)?.content ?? "").trim();
    let parsed = false;
    try { JSON.parse(text.replace(/^```json\s*|```$/g, "")); parsed = true; } catch { /* not clean JSON */ }
    return { ok: r.status === 200 && parsed, note: `parsed=${parsed}; raw=${JSON.stringify(text).slice(0, 100)}` };
  }));

  out.push(await run("response_format json_object", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: 'Return a JSON object with key "ok" set to true.' }], response_format: { type: "json_object" }, max_completion_tokens: BUDGET });
    return { ok: r.status === 200 && hasText(r), note: `http ${r.status}; ${r.status === 200 ? JSON.stringify(msg(r)?.content).slice(0, 80) : r.raw}` };
  }));

  out.push(await run("reasoning_effort=low", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: "What is 17*23?" }], reasoning_effort: "low", max_completion_tokens: BUDGET });
    return { ok: r.status === 200 && hasText(r), note: `http ${r.status}; ${r.status === 200 ? `content=${JSON.stringify(msg(r)?.content).slice(0, 40)}; has_reasoning_field=${Boolean(msg(r)?.reasoning ?? msg(r)?.reasoning_content)}` : r.raw}` };
  }));

  out.push(await run("reasoning_effort=minimal", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: "Reply with the single word OK." }], reasoning_effort: "minimal", max_completion_tokens: BUDGET });
    return { ok: r.status === 200 && hasText(r), note: `http ${r.status}; ${r.status === 200 ? `reply=${JSON.stringify(msg(r)?.content).slice(0, 40)}; reasoning_tokens=${reasoningTokens(r)}` : r.raw}` };
  }));

  out.push(await run("temperature=0.2", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: "Say hi." }], temperature: 0.2, max_completion_tokens: BUDGET });
    return { ok: r.status === 200, note: `http ${r.status}; ${r.status === 200 ? "accepted" : r.raw}` };
  }));

  out.push(await run("image input", async () => {
    const r = await chat(t, { messages: [{ role: "user", content: [{ type: "text", text: "What colour is this image? One word." }, { type: "image_url", image_url: { url: RED_PNG } }] }], max_completion_tokens: BUDGET });
    return { ok: r.status === 200 && hasText(r), note: `http ${r.status}; ${r.status === 200 ? JSON.stringify(msg(r)?.content).slice(0, 60) : r.raw}; reasoning_tokens=${reasoningTokens(r)}` };
  }));

  return out;
}

async function main() {
  const report: Record<string, unknown> = {};
  for (const t of targets) {
    if (!t.key) { report[t.name] = { error: "missing API key env var" }; continue; }
    report[t.name] = { model: t.model, baseUrl: t.baseUrl, probes: await probeTarget(t) };
  }
  console.log(JSON.stringify(report, null, 2));
}

main();

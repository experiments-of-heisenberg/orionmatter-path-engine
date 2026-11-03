/**
 * smoke-models.ts: live connectivity and capability probe for Muse Spark.
 *
 * Purpose: the agent code depends on behaviours (tool calling, JSON output, image
 * input, reasoning control) that must be confirmed against the real APIs rather
 * than assumed from docs. Run it, read the report, and adapt the model client to
 * what actually works. Findings are recorded in docs/api-notes.md.
 *
 * Target:
 *   spark  Muse Spark on the Meta Model API   (MODEL_API_KEY)
 *
 * Output: a JSON report on stdout. Key values are never printed.
 * Run:    npx tsx scripts/smoke-models.ts
 */
import { makePngDataUrl } from "./lib/testImage";
import {
  brief,
  hasText,
  loadTargets,
  messageOf,
  postChat,
  reasoningTokens,
  textOf,
  type ChatResult,
  type Target,
} from "./lib/chatProbe";

/**
 * Token budget per probe. Muse Spark is a reasoning model and its
 * `max_completion_tokens` INCLUDES hidden reasoning tokens, so a small budget can be
 * fully consumed by reasoning and yield an empty answer (observed with 200).
 */
const BUDGET = 3000;

/** One probe result: pass/fail plus a short human-readable note. */
interface Probe {
  probe: string;
  ok: boolean;
  note: string;
  ms: number;
}

/** What a probe body returns before timing is attached. */
interface Verdict {
  ok: boolean;
  note: string;
}

/** Time a probe and convert any thrown error into a failed result. */
async function run(probe: string, fn: () => Promise<Verdict>): Promise<Probe> {
  const start = Date.now();
  try {
    return { probe, ...(await fn()), ms: Date.now() - start };
  } catch (error) {
    return { probe, ok: false, note: `threw: ${(error as Error).message}`, ms: Date.now() - start };
  }
}

/** Verdict for a probe that passes when the call succeeded AND produced text. */
const textVerdict = (r: ChatResult, extra = ""): Verdict => ({
  ok: r.status === 200 && hasText(r),
  note:
    r.status === 200
      ? `${brief(JSON.stringify(textOf(r)), 70)} ${extra}`.trim()
      : `http ${r.status}: ${r.raw}`,
});

const user = (content: unknown) => ({ role: "user", content });

/** Run every capability probe against one target. */
async function probeTarget(t: Target): Promise<Probe[]> {
  const ask = (body: Record<string, unknown>) => postChat(t, { max_completion_tokens: BUDGET, ...body });
  const results: Probe[] = [];

  results.push(
    await run("plain reply", async () => {
      const r = await ask({ messages: [user("Reply with the single word OK.")] });
      return {
        ok: r.status === 200 && /ok/i.test(textOf(r)),
        note: `reply=${brief(textOf(r), 40)}; reasoning_tokens=${reasoningTokens(r)}`,
      };
    }),
  );

  for (const role of ["system", "developer"] as const) {
    results.push(
      await run(`${role} role`, async () => {
        const r = await ask({
          messages: [{ role, content: "Answer in one word." }, user("Capital of France?")],
        });
        return textVerdict(r, `reasoning_tokens=${reasoningTokens(r)}`);
      }),
    );
  }

  results.push(
    await run("tool calling", async () => {
      const r = await ask({
        messages: [user("Use the get_cohort_size tool for role 'backend'.")],
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            function: {
              name: "get_cohort_size",
              description: "Number of engineers in a role family.",
              parameters: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
            },
          },
        ],
      });
      const calls = messageOf(r)?.tool_calls;
      return {
        ok: r.status === 200 && Array.isArray(calls) && calls.length > 0,
        note: `tool_calls=${brief(JSON.stringify(calls ?? null), 150)}; finish=${r.json?.choices?.[0]?.finish_reason ?? "?"}`,
      };
    }),
  );

  results.push(
    await run("json via prompt", async () => {
      const r = await ask({
        messages: [user('Return ONLY a JSON object {"level":"L5","years":7} with no prose.')],
      });
      const text = textOf(r).trim();
      let parsed = false;
      try {
        JSON.parse(text.replace(/^```json\s*|```$/g, ""));
        parsed = true;
      } catch {
        // not clean JSON: reported below
      }
      return {
        ok: r.status === 200 && parsed,
        note: `parsed=${parsed}; raw=${brief(JSON.stringify(text), 90)}`,
      };
    }),
  );

  results.push(
    await run("response_format json_object", async () => {
      const r = await ask({
        messages: [user('Return a JSON object with key "ok" set to true.')],
        response_format: { type: "json_object" },
      });
      return textVerdict(r);
    }),
  );

  for (const effort of ["low", "minimal"] as const) {
    results.push(
      await run(`reasoning_effort=${effort}`, async () => {
        const r = await ask({ messages: [user("What is 17*23?")], reasoning_effort: effort });
        const exposed = Boolean(messageOf(r)?.reasoning ?? messageOf(r)?.reasoning_content);
        return textVerdict(r, `reasoning_tokens=${reasoningTokens(r)}; reasoning_field=${exposed}`);
      }),
    );
  }

  results.push(
    await run("temperature=0.2", async () => {
      const r = await ask({ messages: [user("Say hi.")], temperature: 0.2 });
      return {
        ok: r.status === 200 && hasText(r),
        note: r.status === 200 ? "accepted" : `http ${r.status}: ${r.raw}`,
      };
    }),
  );

  results.push(
    await run("image input", async () => {
      // 64 px or larger: tiny images are misread by both models (see docs/api-notes.md).
      const r = await ask({
        messages: [
          user([
            { type: "text", text: "What colour fills this image? One word." },
            { type: "image_url", image_url: { url: makePngDataUrl(64, 64, [255, 0, 0]) } },
          ]),
        ],
      });
      return {
        ok: r.status === 200 && /red/i.test(textOf(r)),
        note: r.status === 200 ? `answer=${brief(textOf(r), 30)}` : `http ${r.status}: ${r.raw}`,
      };
    }),
  );

  return results;
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {};
  for (const target of loadTargets()) {
    report[target.name] = target.key
      ? { model: target.model, baseUrl: target.baseUrl, probes: await probeTarget(target) }
      : { error: "missing API key env var" };
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * probe-vision.ts — focused image-input probe for the Intake agent.
 *
 * Question it answers: can each Muse model reliably READ an image (colour and text)?
 * The Intake agent depends on this to parse resume / offer-letter screenshots, so we
 * test several image sizes and a rendered text image before designing around it.
 *
 * Run: npx tsx scripts/probe-vision.ts [path/to/text-image.png]
 */
import { readFileSync, existsSync } from "node:fs";
import { makePngDataUrl } from "./lib/testImage";

const targets = [
  { name: "spark", baseUrl: "https://api.meta.ai/v1", key: process.env.MODEL_API_KEY ?? "", model: "muse-spark-1.3" },
  { name: "open", baseUrl: "https://inference.baseten.co/v1", key: process.env.BASETEN_API_KEY ?? "", model: "meta-models/muse-spark-open-1026" },
];

/** Ask a model one question about one image; returns its trimmed text answer. */
async function ask(t: (typeof targets)[number], imageUrl: string, question: string): Promise<string> {
  const res = await fetch(`${t.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: t.model,
      max_completion_tokens: 3000,
      messages: [{ role: "user", content: [{ type: "text", text: question }, { type: "image_url", image_url: { url: imageUrl } }] }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.status !== 200) return `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 160)}`;
  return String(json.choices?.[0]?.message?.content ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
}

async function main() {
  const colourCases: [string, number, [number, number, number]][] = [
    ["8x8 red", 8, [255, 0, 0]],
    ["64x64 red", 64, [255, 0, 0]],
    ["256x256 red", 256, [255, 0, 0]],
    ["256x256 blue", 256, [0, 0, 255]],
  ];
  for (const t of targets) {
    console.log(`\n== ${t.name} :: ${t.model}`);
    for (const [label, size, rgb] of colourCases) {
      const answer = await ask(t, makePngDataUrl(size, size, rgb), "What single colour fills this image? Answer with one word.");
      console.log(`  colour ${label.padEnd(12)} -> ${answer}`);
    }
    const textPath = process.argv[2];
    if (textPath && existsSync(textPath)) {
      const url = `data:image/png;base64,${readFileSync(textPath).toString("base64")}`;
      const answer = await ask(t, url, "Transcribe the text in this image exactly.");
      console.log(`  text image      -> ${answer}`);
    }
  }
}
main();

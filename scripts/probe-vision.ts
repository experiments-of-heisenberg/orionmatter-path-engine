/**
 * probe-vision.ts: focused image-input probe for the Intake agent.
 *
 * Question it answers: can each Muse model reliably READ an image (colour and text)?
 * The Intake agent depends on this to parse resume and offer-letter screenshots, so
 * we test several image sizes and a rendered text image before designing around it.
 *
 * Run: npx tsx scripts/probe-vision.ts [path/to/text-image.png]
 */
import { existsSync, readFileSync } from "node:fs";
import { brief, loadTargets, postChat, textOf, type Target } from "./lib/chatProbe";
import { makePngDataUrl } from "./lib/testImage";

/** Ask one model one question about one image; returns a compact answer string. */
async function ask(target: Target, imageUrl: string, question: string): Promise<string> {
  const result = await postChat(target, {
    max_completion_tokens: 3000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return result.status === 200 ? brief(textOf(result), 160) : `HTTP ${result.status}: ${result.raw}`;
}

async function main(): Promise<void> {
  const colourCases: [string, number, [number, number, number]][] = [
    ["8x8 red", 8, [255, 0, 0]],
    ["64x64 red", 64, [255, 0, 0]],
    ["256x256 red", 256, [255, 0, 0]],
    ["256x256 blue", 256, [0, 0, 255]],
  ];
  const textImagePath = process.argv[2];

  for (const target of loadTargets()) {
    console.log(`\n== ${target.name} :: ${target.model}`);
    for (const [label, size, rgb] of colourCases) {
      const answer = await ask(
        target,
        makePngDataUrl(size, size, rgb),
        "What single colour fills this image? One word.",
      );
      console.log(`  colour ${label.padEnd(12)} -> ${answer}`);
    }
    if (textImagePath && existsSync(textImagePath)) {
      const url = `data:image/png;base64,${readFileSync(textImagePath).toString("base64")}`;
      console.log(
        `  text image      -> ${await ask(target, url, "Transcribe the text in this image exactly.")}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

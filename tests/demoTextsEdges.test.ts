/** The one-click example texts: clean characters, passing the input checks, and unique fixtures. */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMessage } from "../src/ui/chat";
import { DEMO_BIO, DEMO_STORY, exampleMessage, WHATIF_EXAMPLES } from "../src/ui/demo";
import { checkIntakeInput } from "../src/ui/intake";
import { checkStory } from "../src/ui/privacy";

/** True when the text holds a C0/C1 control character or DEL (tabs and newlines count too). */
function hasControl(text: string): boolean {
  return [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code >= 0 && code <= 31) || code === 127;
  });
}

describe("demo texts", () => {
  it("DEMO_STORY has no control characters, tabs or newlines, and is under 400 characters", () => {
    expect(hasControl(DEMO_STORY)).toBe(false);
    expect(DEMO_STORY).not.toContain("\t");
    expect(DEMO_STORY).not.toContain("\n");
    expect(DEMO_STORY.length).toBeLessThan(400);
  });

  it("DEMO_BIO has no control characters, tabs or newlines, and is under 400 characters", () => {
    expect(hasControl(DEMO_BIO)).toBe(false);
    expect(DEMO_BIO).not.toContain("\t");
    expect(DEMO_BIO).not.toContain("\n");
    expect(DEMO_BIO.length).toBeLessThan(400);
  });

  it("DEMO_STORY survives checkIntakeInput unchanged", () => {
    expect(checkIntakeInput({ text: DEMO_STORY, image: undefined })).toEqual({
      ok: true,
      text: DEMO_STORY,
    });
  });

  it("DEMO_BIO survives checkStory unchanged", () => {
    expect(checkStory(DEMO_BIO)).toEqual({ ok: true, text: DEMO_BIO });
  });

  it("every What if example survives checkMessage and exampleMessage leaves no U+2019", () => {
    for (const example of WHATIF_EXAMPLES) {
      expect(checkMessage(example)).toEqual({ ok: true, text: example });
      expect(exampleMessage(example)).not.toContain("’");
    }
  });

  it("each example is a distinct string", () => {
    expect(new Set(WHATIF_EXAMPLES).size).toBe(WHATIF_EXAMPLES.length);
  });

  it("the fixtures folder has no two files with the same label and key", () => {
    const files = readdirSync("src/fixtures").filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(`src/fixtures/${file}`, "utf8")) as {
        label?: unknown;
        key?: unknown;
      };
      expect(typeof parsed.label).toBe("string");
      expect(typeof parsed.key).toBe("string");
      const id = `${String(parsed.label)} ${String(parsed.key)}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});

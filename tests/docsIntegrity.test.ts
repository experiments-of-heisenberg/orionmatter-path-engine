/**
 * The documents are part of the product, so they are tested like it: every link resolves, every command exists, the pictures
 * match what the app draws now, and the counts the README states are the real counts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCardSvg, renderMapSvg } from "../scripts/lib/readmeImages";

const read = (path: string): string => readFileSync(path, "utf8");
const markdown = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f));
// Muse Code's fact-check quotes a link that was broken at the time, so it is evidence and not a page to be kept correct.
const DOCS = [
  "README.md",
  ...markdown("docs"),
  ...markdown("docs/parts"),
  ...markdown("docs/adr"),
  ...markdown("docs/muse-code"),
].filter((f) => !f.endsWith("part15-factcheck.md"));
const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

describe("links", () => {
  it.each(DOCS.map((f) => [f]))(
    "every relative link and image in %s points at a file that exists",
    (file) => {
      const missing: string[] = [];
      for (const match of read(file).matchAll(/\]\((?!https?:\/\/|#|mailto:)([^)\s]+)\)/g)) {
        const target = (match[1] ?? "").split("#")[0] ?? "";
        if (target && !existsSync(normalize(join(dirname(file), target)))) missing.push(target);
      }
      expect(missing).toEqual([]);
    },
  );
});

describe("commands", () => {
  const COMMANDS = /npm (?:run (?:--silent )?([a-z:-]+)|(test|start|ci))/g;
  it.each([["README.md"], ["docs/deploy.md"], ["docs/demo.md"], ["docs/submission.md"], ["docs/evals.md"]])(
    "every npm command named in %s exists in package.json",
    (file) => {
      const unknown: string[] = [];
      for (const match of read(file).matchAll(COMMANDS)) {
        const name = match[1] ?? match[2] ?? "";
        if (name && name !== "ci" && !(name in scripts) && name !== "test" && name !== "start")
          unknown.push(name);
      }
      expect(unknown).toEqual([]);
    },
  );
});

describe("what the README states", () => {
  const readme = read("README.md");
  it("the number of ADRs it cites is the number there are", () => {
    const actual = readdirSync("docs/adr").filter((f) => /^\d{4}-.*\.md$/.test(f)).length;
    expect(readme).toContain(`${actual} [ADRs]`);
    expect(read("docs/submission.md")).toContain(`${actual} decision records`);
  });
  it("it has the sections a judge looks for", () => {
    for (const heading of [
      "## Why this exists",
      "## What you can do",
      "## How it works",
      "## Built with Muse Code",
      "## How this maps to the judging criteria",
      "## Run it",
      "## Limits, stated plainly",
    ]) {
      expect(readme).toContain(heading);
    }
    for (const criterion of ["Impact", "Use of Meta tooling", "Technical depth", "Demo"])
      expect(readme).toContain(`**${criterion}**`);
  });
  it("every tab it lists is a tab the app has", () => {
    const app = read("src/components/PathApp.tsx");
    for (const label of ["Your story", "Map", "What if", "Plan", "Compare", "Privacy", "Share", "Why"]) {
      expect(app).toContain(`label: "${label}"`);
      expect(readme).toContain(`**${label}**`);
    }
  });
  it("the model named is the one the code defaults to", () => {
    expect(readme).toContain("muse-spark-1.3");
    expect(read("src/lib/env.ts")).toContain('default("muse-spark-1.3")');
  });
  it("placeholders for the links exist only where the maintainer fills them in", () => {
    for (const file of [...DOCS, "src/components/PathApp.tsx"]) {
      if (["README.md", "docs/submission.md", "docs/deploy.md", "docs/demo.md"].includes(file)) continue;
      expect(read(file), file).not.toMatch(/<(LIVE|DEMO|VIDEO|REPO)_URL>/);
    }
  });
});

describe("the pictures in the README are what the app draws", () => {
  it("map.svg and trail-card.svg equal a fresh render (run `npm run docs:images` if this fails)", async () => {
    expect(read("docs/images/map.svg")).toBe(await renderMapSvg());
    expect(read("docs/images/trail-card.svg")).toBe(await renderCardSvg());
  });
  it("they are safe to embed: no script, no event handlers, no outside address", () => {
    for (const file of ["docs/images/map.svg", "docs/images/trail-card.svg"]) {
      const svg = read(file);
      expect(svg).not.toMatch(
        /<script|javascript:|\son[a-z]+=|<foreignObject|<image|xlink:href|href="https?:/i,
      );
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toContain("Synthetic cohort of 484 engineers");
    }
  });
});

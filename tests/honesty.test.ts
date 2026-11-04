/**
 * The honesty rules, as a test. The product's whole argument is that it does not overclaim, so words that overclaim are
 * kept out of what a person reads: the screens, and the README and the docs written for judges. A banned phrase is allowed
 * only where it is being denied ("not a guarantee", "never predicts"), and the pages that list what not to say are exempt.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string, keep: (f: string) => boolean): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? name === "api"
        ? []
        : files(path, keep)
      : keep(path)
        ? [path]
        : [];
  });

const SCREENS = files("src", (f) => /\.(tsx?|css)$/.test(f) && !f.includes("/lib/"));
const JUDGE_DOCS = ["README.md", "docs/deploy.md", "docs/evals.md", "docs/submission.md"];

const BANNED: [string, RegExp][] = [
  ["on-device processing", /on-device/i],
  ["open weights", /open[- ]weights?/i],
  ["private by default", /private by default/i],
  ["prediction", /\bpredict(s|ion|ions|ing)?\b/i],
  ["a promise of an outcome", /\bwill (reach|become|get|make it)\b/i],
  ["a guarantee", /\bguarantee(s)?\b/i],
  ["screening people", /screen(s|ing)? (job )?candidates/i],
  ["real data", /\breal (career |engineer )?data\b/i],
  ["accuracy", /\b(highly |very )?accurate\b/i],
];
const DENIAL = /\b(not|no|never|cannot|can't|without|nor|neither|nothing|isn't|aren't)\b/i;

function violations(path: string): string[] {
  const out: string[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [name, pattern] of BANNED) {
      const match = pattern.exec(line);
      if (!match) continue;
      const before = lines
        .slice(Math.max(0, index - 1), index + 1)
        .join(" ")
        .slice(0, Math.max(0, line.length + (index > 0 ? (lines[index - 1] ?? "").length : 0)));
      const near = before.slice(
        Math.max(0, before.toLowerCase().indexOf(match[0].toLowerCase()) - 80),
        before.toLowerCase().indexOf(match[0].toLowerCase()),
      );
      if (!DENIAL.test(near) && !/\bnever claim|do not claim|no claim|not claim/i.test(line))
        out.push(`${path}:${index + 1} ${name}: ${line.trim().slice(0, 120)}`);
    }
  });
  return out;
}

describe("nothing a person reads overclaims", () => {
  it("the screens (components, ui, app) contain no banned claim outside a denial", () => {
    expect(SCREENS.length).toBeGreaterThan(30);
    expect(SCREENS.flatMap(violations)).toEqual([]);
  });
  it("the README and the docs written for judges contain none either", () => {
    expect(JUDGE_DOCS.flatMap(violations)).toEqual([]);
  });
  it("the checker itself catches an overclaim and lets a denial through", () => {
    const dir = "/tmp/honesty-probe.md";
    for (const [text, expected] of [
      ["Orionmatter predicts your next role.", 1],
      ["It runs on-device.", 1],
      ["We guarantee a result.", 1],
      ["This is not a guarantee.", 0],
      ["It never predicts anything.", 0],
      ["Built on real data from engineers.", 1],
    ] as const) {
      writeFileSync(dir, text);
      expect(violations(dir), text).toHaveLength(expected);
    }
  });
});

describe("the one model provider", () => {
  it("no runtime file, script or config names a second provider", () => {
    const places = [
      ...files("src", (f) => /\.(tsx?|json)$/.test(f)),
      ...files("scripts", (f) => /\.(tsx?|sh)$/.test(f)),
      ".env.example",
      "package.json",
    ];
    const hits = places.filter((p) => /baseten|BASETEN/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
});

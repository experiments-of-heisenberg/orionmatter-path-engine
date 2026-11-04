/**
 * honestyEdges.test.ts: edge probes for the honesty rules.
 *
 * Why: tests/honesty.test.ts keeps overclaims out of the screens and the
 * judge-facing docs, but its checker is not exported, so this file
 * re-implements the same idea (a banned-phrase list plus a denial window)
 * and probes it with 30 tricky strings: case and punctuation variants,
 * denials in different shapes, and neighbours that must not trip the rule.
 * It also scans the real screens and docs for privacy/security wording and
 * reports every hit as a doubt (without failing): each such word is a claim
 * that must be true.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Banned phrases, same idea as the committed checker but hardened: the
 * committed `/on-device/i` misses "OnDevice" and "on device", and
 * `/\bguarantee(s)?\b/i` misses "guaranteed", so those gaps are closed here
 * (and reported below).
 */
const BANNED: [string, RegExp][] = [
  ["on-device processing", /on[-\s]?device/i],
  ["open weights", /open[- ]weights?/i],
  ["private by default", /private by default/i],
  ["prediction", /\bpredict(s|ion|ions|ing)?\b/i],
  ["a promise of an outcome", /\bwill (reach|become|get|make it)\b/i],
  ["a guarantee", /\bguarantee[sd]?\b/i],
  ["screening people", /screen(s|ing)? (job )?candidates/i],
  ["real data", /\breal (career |engineer )?data\b/i],
  ["accuracy", /\b(highly |very )?accurate\b/i],
];
const DENIAL = /\b(not|no|never|cannot|can't|without|nor|neither|nothing|isn't|aren't|doesn't|don't)\b/i;

/**
 * Does this line make a banned claim outside a denial? A denial word within
 * 80 characters before the match excuses it.
 */
function violates(line: string): boolean {
  for (const [_name, pattern] of BANNED) {
    const match = pattern.exec(line);
    if (!match || match.index === undefined) continue;
    const before = line.slice(Math.max(0, match.index - 80), match.index);
    if (!DENIAL.test(before)) return true;
  }
  return false;
}

/** 30 probe strings: [text, expected to violate]. */
const PROBES: [string, boolean][] = [
  // Overclaims in different cases and punctuation: all must be caught.
  ["Orionmatter PREDICTS your next role.", true],
  ["You will reach Staff within a year.", true],
  ["Guaranteed results for every engineer.", true],
  ["Our ranges are 100% accurate.", true],
  ["Built on open-weights models.", true],
  ["Built on open weights models.", true],
  ["It runs OnDevice for privacy.", true],
  ["Everything runs on device locally.", true],
  ["We screen candidates for employers.", true],
  ["Private by default, always.", true],
  ["Trained on real data from engineers.", true],
  ["This prediction is highly accurate.", true],
  ["You will become Staff Engineer.", true],
  ["We GUARANTEE you will get promoted.", true],
  ["Screening job candidates is our business.", true],
  // Denials in different shapes: none must be caught.
  ["We make no guarantee about outcomes.", false],
  ["This does not predict your future.", false],
  ["The app never promises anything.", false],
  ["Nothing here runs on-device.", false],
  ["This is not on-device processing.", false],
  ["We do not screen candidates.", false],
  ["Not a prediction about you.", false],
  ["No promise of an outcome is made.", false],
  ["It cannot guarantee a result.", false],
  ["Neither accurate nor a prediction.", false],
  ["Without any guarantee, here are ranges.", false],
  // Tricky neighbours.
  ["Promised or guaranteed an outcome", true], // the Skeptic finding title in src/ui/trace.ts: flagged by a naive scan, but lib files are excluded from the committed scan
  ["The Skeptic checks for overclaiming language.", false],
  ["Never say guaranteed results.", false], // denial window excuses it
  ["Accurate to the month, we promise.", true],
];

describe("the honesty idea on edge strings", () => {
  it("probes exactly 30 strings", () => {
    expect(PROBES).toHaveLength(30);
  });
  it.each(PROBES)("'%s' violates: %s", (text, expected) => {
    expect(violates(text)).toBe(expected);
  });
  it("documents gaps in the committed checker (same strings, committed patterns)", () => {
    // Literal copies of the committed patterns in tests/honesty.test.ts.
    const committedOnDevice = /on-device/i;
    const committedGuarantee = /\bguarantee(s)?\b/i;
    // These overclaims slip through the committed checker today.
    expect(committedOnDevice.test("It runs OnDevice for privacy.")).toBe(false);
    expect(committedOnDevice.test("Everything runs on device locally.")).toBe(false);
    expect(committedGuarantee.test("Guaranteed results for every engineer.")).toBe(false);
  });
});

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "api" ? [] : walk(path);
    return /\.(tsx?|css|md)$/.test(path) ? [path] : [];
  });

/** Words that make a privacy or security claim wherever they appear. */
const DOUBT_WORDS = [
  "on device",
  "ondevice",
  "runs locally",
  "locally",
  "stored",
  "we store",
  "encrypted",
  "secure",
  "anonymous",
  "anonymised",
  "HIPAA",
  "GDPR",
  "SOC",
  "private",
];

describe("privacy and security wording doubts (reported, never failed)", () => {
  it("lists every hit in the screens and the judge-facing docs", () => {
    const files = [
      ...walk("src/components"),
      ...walk("src/ui"),
      ...walk("src/app"),
      "README.md",
      "docs/deploy.md",
      "docs/evals.md",
      "docs/submission.md",
      "docs/demo.md",
    ];
    expect(files.length).toBeGreaterThan(30);
    const doubts: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const word of DOUBT_WORDS) {
          if (line.toLowerCase().includes(word)) {
            doubts.push(`${file}:${index + 1} [${word}] ${line.trim().slice(0, 110)}`);
            break;
          }
        }
      });
    }
    for (const doubt of doubts) console.log(`doubt: ${doubt}`);
    console.log(`doubt scan: ${doubts.length} hit(s) in ${files.length} file(s), reported only`);
    expect(files.length).toBeGreaterThan(0);
  });
});

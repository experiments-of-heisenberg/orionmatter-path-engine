/** Privacy edges: odd ladders, odd k, odd stories, and a sweep of pay-shaped strings. */
import { describe, expect, it } from "vitest";
import type { FindingCategory, LadderRung, PrivacyFinding } from "../src/lib/privacy";
import { detectIdentifiers } from "../src/lib/privacy/detectors";
import {
  CATEGORY_TITLE,
  MAX_STORY,
  checkStory,
  findingGroups,
  kPosition,
  ladderRows,
  privacyBody,
  shareSummary,
} from "../src/ui/privacy";

const rung = (added: string, size: number, passes: boolean): LadderRung => ({
  added,
  shared: added,
  size,
  passes,
});

describe("ladderRows with odd ladders", () => {
  it("bars scale to the largest crowd even when sizes grow or tie (stated, not the real shape)", () => {
    const down = ladderRows([rung("a", 100, true), rung("b", 50, true), rung("c", 10, false)]);
    expect(down.map((r) => r.width)).toEqual([1, 0.5, 0.1]);
    const up = ladderRows([rung("a", 10, true), rung("b", 50, true), rung("c", 100, true)]);
    expect(up.map((r) => r.width)).toEqual([0.1, 0.5, 1]); // impossible from the server, still well formed
    const tied = ladderRows([rung("a", 50, true), rung("b", 50, false)]);
    expect(tied.map((r) => r.width)).toEqual([1, 1]);
  });

  it("sizes 0, 1 and a million stay finite with a sentence each", () => {
    const rows = ladderRows([rung("a", 0, false), rung("b", 1, false), rung("c", 1_000_000, true)]);
    expect(rows.map((r) => r.width)).toEqual([0, 0.000001, 1]);
    for (const row of rows) {
      expect(Number.isFinite(row.width)).toBe(true);
      expect(row.sentence.length).toBeGreaterThan(10);
    }
  });

  it("passes flags inconsistent with sizes are echoed untouched; the rows stay well formed", () => {
    const rows = ladderRows([rung("a", 0, true), rung("b", 1_000_000, false)]);
    expect(rows.map((r) => r.passes)).toEqual([true, false]);
    for (const row of rows) {
      expect(Number.isFinite(row.width)).toBe(true);
      expect(typeof row.sentence).toBe("string");
    }
  });
});

describe("kPosition with odd k", () => {
  const ladder = [rung("a", 200, true), rung("b", 50, true)];

  it("states: 0 and negative k sit at 0, huge k at 1, NaN returns NaN", () => {
    expect(kPosition(ladder, 0)).toBe(0);
    expect(kPosition(ladder, -5)).toBe(0);
    expect(kPosition(ladder, Number.POSITIVE_INFINITY)).toBe(1);
    expect(kPosition(ladder, Number.NaN)).toBeNaN();
    // REPORT: a NaN k would reach the ladder's CSS as `left: NaN%`. The screen only offers
    // fixed options so this cannot happen from the UI, but kPosition does not defend against it.
  });
});

describe("shareSummary with k 1", () => {
  it("reads plainly in both branches", () => {
    expect(shareSummary({ k: 1, fullPasses: true, shareableUpTo: "x", dropToReachK: [] })).toBe(
      "Sharing all of it still leaves a crowd of at least 1.",
    );
    expect(shareSummary({ k: 1, fullPasses: false, shareableUpTo: null, dropToReachK: [] })).toBe(
      "Even your first detail leaves fewer than 1 comparable engineers.",
    );
  });
});

describe("findingGroups with every category", () => {
  it("groups all 11 categories at once with unique titles", () => {
    const categories = Object.keys(CATEGORY_TITLE) as FindingCategory[];
    expect(categories).toHaveLength(11);
    const findings: PrivacyFinding[] = categories.map((category) => ({
      category,
      quote: `q-${category}`,
      reason: "r",
      source: "model",
    }));
    const groups = findingGroups(findings);
    expect(groups).toHaveLength(11);
    expect(new Set(groups.map((g) => g.title)).size).toBe(11);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });
});

describe("checkStory with odd text", () => {
  it("accepts only emoji, refuses only newlines, keeps a lone surrogate", () => {
    expect(checkStory("🎉🎉🎉")).toEqual({ ok: true, text: "🎉🎉🎉" });
    expect(checkStory("\n\n\n").ok).toBe(false);
    // A lone surrogate is not cleaned: it is accepted as-is.
    expect(checkStory("\ud83d")).toEqual({ ok: true, text: "\ud83d" });
  });

  it("states: length counts UTF-16 units, so 1500 emoji are 3000 characters", () => {
    const full = "🎉".repeat(1500);
    expect(full.length).toBe(MAX_STORY);
    expect(checkStory(full).ok).toBe(true);
    expect(checkStory(`${full}x`).ok).toBe(false);
  });
});

describe("privacyBody with k NaN", () => {
  it("states: the JSON would contain null, which the server would reject (reported as a doubt)", () => {
    const body = privacyBody({ k: Number.NaN, companyType: undefined });
    expect(JSON.stringify(body)).toBe('{"k":null}');
    // DOUBT: JSON has no NaN, so a NaN k arrives as null and fails the server's k schema
    // (an integer from 1 to 1000). Unreachable from the fixed options, but not defended here.
  });
});

describe("detectIdentifiers: a sweep of pay-shaped strings", () => {
  const pay = (text: string): string[] =>
    detectIdentifiers(text)
      .filter((f) => f.category === "exact_compensation")
      .map((f) => f.quote);

  // Each entry states which quotes are flagged. Plainly wrong results are reported in the
  // final message as doubts, never by failing: the expectations below encode what code does.
  const cases: [string, string[]][] = [
    ["12,00,000 Rs", ["12,00,000 Rs"]],
    ["Rs 5", ["Rs 5"]],
    ["rs.50000", []], // lowercase prefix with no space: missed
    ["USD 100", ["USD 100"]],
    ["100 dollars", ["100 dollars"]],
    ["3 pounds of flour", ["3 pounds"]], // ordinary cooking prose: flagged
    ["I have 2 euros", ["2 euros"]],
    ["5 Rs-compatible", ["5 Rs"]],
    ["$", []],
    ["rupees 5", []], // currency word before the amount is not a shape code reads
    ["I earned 4200000 rupees in 2023.", ["4200000 rupees"]],
    ["They paid 85,000 dollars a year", ["85,000 dollars"]],
    ["I make $180k", ["$180k"]],
    ["₹45,00,000 a year", ["₹45,00,000"]],
    ["30 LPA plus bonus", ["30 LPA"]],
    ["INR 45000 a month", ["INR 45000"]],
    ["Rs. 12,00,000 per year", ["Rs. 12,00,000"]],
    ["about 70000 euros", ["70000 euros"]],
    ["50000 pounds", ["50000 pounds"]],
    ["I managed 3 rsync jobs", []],
    ["a 2023 roadmap with 4 dollarama stores", []],
    ["5 pounding tasks", []],
    ["I make $120k and 30 LPA", ["$120k", "30 LPA"]],
    ["paid $ 45,000 last year", ["$ 45,000"]],
    ["EUR 99 for the book", ["EUR 99"]],
  ];

  it("flags exactly the 25 stated cases", () => {
    expect(cases).toHaveLength(25);
    for (const [text, expected] of cases) expect(pay(text)).toEqual(expected);
  });
});

/** The Privacy tab's logic: ladder rows, sentences, groups, story checks, and agreement with the server. */
import { describe, expect, it } from "vitest";
import { DEFAULT_K, MAX_STORY_CHARS, type LadderRung, type PrivacyFinding } from "../src/lib/privacy";
import { COHORT } from "../src/lib/tools/data";
import {
  COMPANY_TYPES,
  DEFAULT_K_UI,
  K_OPTIONS,
  MAX_STORY,
  RISK_WORD,
  checkStory,
  findingGroups,
  kPosition,
  ladderRows,
  privacyBody,
  rungSentence,
  shareSummary,
  sourceWords,
  textCheckWords,
} from "../src/ui/privacy";
import { STORY, assessed, modelFindings } from "./helpers/privacy";

const rung = (size: number, over: Partial<LadderRung> = {}): LadderRung => ({
  added: "role",
  label: "backend",
  shared: "backend",
  size,
  passes: size >= 10,
  ...over,
});

describe("agreement with the server", () => {
  it("the story limit, the default crowd size and the company types are the server's and the data's", () => {
    expect(MAX_STORY).toBe(MAX_STORY_CHARS);
    expect(DEFAULT_K_UI).toBe(DEFAULT_K);
    expect(K_OPTIONS).toContain(DEFAULT_K);
    const types = [...new Set(COHORT.flatMap((r) => r.companyTypeSteps))].sort();
    expect([...COMPANY_TYPES].sort()).toEqual(types);
  });
});

describe("the ladder", () => {
  it("is drawn from a real assessment: four steps that only shrink, bars scaled to the first, all passing at k=10", async () => {
    const a = await assessed();
    const rows = ladderRows(a.ladder);
    expect(rows.map((r) => [r.added, r.size])).toEqual([
      ["role", 197],
      ["level", 93],
      ["goal", 68],
      ["region", 11],
    ]);
    expect(rows[0]?.width).toBe(1);
    for (let i = 1; i < rows.length; i++) expect(rows[i]?.width).toBeLessThanOrEqual(rows[i - 1]?.width ?? 0);
    expect(rows.every((r) => r.passes)).toBe(true);
    expect(rows[3]?.width).toBeCloseTo(11 / 197);
  });

  it("with a company type and the default k the last step falls below the crowd and is marked so", async () => {
    const a = await assessed({ companyType: "robotics" });
    const rows = ladderRows(a.ladder);
    expect(rows.at(-1)).toMatchObject({ added: "company type", size: 4, passes: false });
    expect(shareSummary(a)).toBe(
      "You can share up to backend, L5, goal L6, IN-south and stay in a crowd of at least 10. To get back to 10, leave out: region.",
    );
  });

  it("an empty ladder gives no rows and a zero-size crowd does not divide by zero", () => {
    expect(ladderRows([])).toEqual([]);
    expect(ladderRows([rung(0)])[0]?.width).toBe(0);
  });

  it("sentences say the number; one engineer means you would be unique; zero means you would be singled out", () => {
    expect(rungSentence(rung(93, { shared: "backend, L5" }))).toBe(
      "Sharing backend, L5 leaves 93 comparable engineers who match.",
    );
    expect(rungSentence(rung(1))).toContain("exactly 1 comparable engineer: you would be unique");
    expect(rungSentence(rung(0))).toContain("matches no one in the cohort");
  });

  it("the k line sits where k falls on the bars, and stays inside the chart", () => {
    const l = [rung(200), rung(50)];
    expect(kPosition(l, 10)).toBeCloseTo(0.05);
    expect(kPosition(l, 1000)).toBe(1);
    expect(kPosition(l, 0)).toBe(0);
    expect(kPosition([], 10)).toBe(1);
  });

  it("shareSummary: all of it passes; nothing passes; part passes", () => {
    expect(shareSummary({ k: 10, fullPasses: true, shareableUpTo: "x", dropToReachK: [] })).toBe(
      "Sharing all of it still leaves a crowd of at least 10.",
    );
    expect(shareSummary({ k: 10, fullPasses: false, shareableUpTo: null, dropToReachK: ["role"] })).toBe(
      "Even your first detail leaves fewer than 10 comparable engineers.",
    );
    expect(shareSummary({ k: 5, fullPasses: false, shareableUpTo: "backend", dropToReachK: [] })).toBe(
      "You can share up to backend and stay in a crowd of at least 5.",
    );
  });
});

describe("findings", () => {
  const f = (
    category: PrivacyFinding["category"],
    quote: string,
    source: PrivacyFinding["source"] = "model",
  ): PrivacyFinding => ({ category, quote, reason: "r", source });
  it("are grouped by kind in first-seen order with plain titles", () => {
    const groups = findingGroups([f("employer", "A"), f("exact_date", "B", "code"), f("employer", "C")]);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ["Employers", 2],
      ["Exact dates", 1],
    ]);
    expect(findingGroups([])).toEqual([]);
  });
  it("say who found them: code, or the model with its quote checked by code", () => {
    expect(sourceWords({ source: "code" })).toBe("Found by code");
    expect(sourceWords({ source: "model" })).toBe("Proposed by Muse Spark, quote checked by code");
  });
  it("text-check words cover all three states", () => {
    expect(textCheckWords("done")).toContain("code kept only details whose quote is really in your words");
    expect(textCheckWords("code_only")).toContain("The model was not used");
    expect(textCheckWords("skipped")).toBe("No text to check.");
  });
  it("every risk level has a word", () => {
    expect(RISK_WORD).toEqual({ low: "Low risk", medium: "Medium risk", high: "High risk" });
  });
});

describe("a real text check", () => {
  it("keeps the real quotes and drops the invented one, as the server decided", async () => {
    const a = await assessed({ text: STORY }, [modelFindings]);
    expect(a.findings.map((x) => x.quote)).toEqual([
      "jo@example.com",
      "4200000 rupees",
      "Acme Robotics",
      "Orion arm project",
    ]);
    expect(findingGroups(a.findings).map((g) => g.title)).toEqual([
      "Contact details",
      "Exact pay",
      "Employers",
      "Projects and products",
    ]);
    expect(a.notes.join(" ")).toContain("Discarded 1 proposed item");
  });
});

describe("checkStory and privacyBody", () => {
  it("trims, strips control characters, refuses empty and over-long text with the count", () => {
    expect(checkStory("  hello\u0000 world ")).toEqual({ ok: true, text: "hello world" });
    expect(checkStory("   ").ok).toBe(false);
    expect(checkStory("x".repeat(MAX_STORY)).ok).toBe(true);
    const over = checkStory("x".repeat(MAX_STORY + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain(`${MAX_STORY + 1} characters`);
  });
  it("builds a request without text for the ladder, and with text and the model choice for a check", () => {
    expect(privacyBody({ k: 10, companyType: undefined })).toEqual({ k: 10 });
    expect(privacyBody({ k: 5, companyType: "robotics" })).toEqual({ k: 5, companyType: "robotics" });
    expect(privacyBody({ k: 10, companyType: undefined }, { text: "t", useModel: false })).toEqual({
      k: 10,
      text: "t",
      useModel: false,
    });
  });
});

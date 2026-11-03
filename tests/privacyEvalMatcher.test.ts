/** Tests for the Privacy Guard evaluation matcher and case set, offline: the judge must be correct first. */
import { describe, expect, it } from "vitest";
import { PRIVACY_CASES, type PrivacyCase } from "../evals/privacy/cases";
import { checkPrivacy } from "../evals/privacy/check";
import type { PrivacyAssessment, PrivacyFinding } from "../src/lib/privacy";

const f = (
  quote: string,
  category: PrivacyFinding["category"],
  source: PrivacyFinding["source"] = "model",
): PrivacyFinding => ({ quote, category, reason: "r", source });
const result = (
  findings: PrivacyFinding[] = [],
  over: Partial<PrivacyAssessment> = {},
): PrivacyAssessment => ({
  risk: findings.length > 0 ? "medium" : "low",
  reasons: [],
  k: 10,
  ladder: [],
  fullPasses: true,
  shareableUpTo: null,
  dropToReachK: [],
  findings,
  textCheck: "done",
  generalisedText: "clean",
  notes: [],
  basis: "b",
  ...over,
});
const caseOf = (expectation: PrivacyCase["expect"]): PrivacyCase => ({
  id: "t",
  category: "identifying",
  text: "x",
  expect: expectation,
});

describe("checkPrivacy", () => {
  it("passes when everything expected is found and nothing banned is flagged", () => {
    expect(
      checkPrivacy(
        caseOf({ mustFind: [{ quoteIncludes: "acme", category: "employer" }], mustNotFind: ["go"] }),
        result([f("Acme Robotics", "employer")]),
      ),
    ).toEqual([]);
  });

  it("explains a missing finding, a wrong category and a banned flag", () => {
    expect(
      checkPrivacy(
        caseOf({ mustFind: [{ quoteIncludes: "Acme", category: "employer" }] }),
        result([f("Acme", "other")]),
      ),
    ).toEqual(['no finding contains "Acme" as employer']);
    expect(checkPrivacy(caseOf({ mustNotFind: ["go"] }), result([f("Go", "other")]))).toEqual([
      'flagged "Go", which is not identifying',
    ]);
    expect(checkPrivacy(caseOf({ mustNotFind: ["go"] }), result([f("go-lang team", "other")])).length).toBe(
      1,
    ); // a banned WORD inside a quote
    expect(checkPrivacy(caseOf({ mustNotFind: ["go"] }), result([f("goal", "other")]))).toEqual([]); // but not a longer word
  });

  it("counts only model findings for 'no model findings', so code findings are allowed", () => {
    expect(
      checkPrivacy(caseOf({ noModelFindings: true }), result([f("jo@x.com", "contact_detail", "code")])),
    ).toEqual([]);
    expect(checkPrivacy(caseOf({ noModelFindings: true }), result([f("Acme", "employer")]))[0]).toContain(
      'expected no model findings, got "Acme"',
    );
  });

  it("fails when the text check did not run, when findings exist with low risk, and when the preview leaks a quote", () => {
    expect(checkPrivacy(caseOf({}), result([], { textCheck: "code_only" }))).toEqual([
      'text check was "code_only", not "done"',
    ]);
    expect(checkPrivacy(caseOf({}), result([f("Acme", "employer")], { risk: "low" }))).toEqual([
      "findings exist but risk is low",
    ]);
    expect(
      checkPrivacy(caseOf({}), result([f("Acme", "employer")], { generalisedText: "I joined ACME today" })),
    ).toEqual(['the generalised text still contains "Acme"']);
  });
});

describe("the case set", () => {
  it("has unique ids and covers every category", () => {
    const ids = PRIVACY_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PRIVACY_CASES.map((c) => c.category))).toEqual(
      new Set(["identifying", "generic", "safety"]),
    );
  });

  it("keeps every story within the length limit and gives every case an expectation", () => {
    for (const c of PRIVACY_CASES) {
      expect(c.text.length).toBeLessThanOrEqual(3000);
      expect(Object.keys(c.expect).length).toBeGreaterThan(0);
    }
  });
});

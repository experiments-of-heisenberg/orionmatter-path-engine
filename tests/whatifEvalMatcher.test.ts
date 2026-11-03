/**
 * Tests for the evaluation matcher itself. An evaluation is only trustworthy if the thing that
 * judges it is correct, so the matcher is tested offline against hand-made interpretations.
 */
import { describe, expect, it } from "vitest";
import { checkInterpretation, startingConstraints } from "../evals/whatif/check";
import { WHATIF_CASES, type EvalCase } from "../evals/whatif/cases";
import { Constraints } from "../src/lib/schemas";
import type { Interpretation } from "../src/lib/whatif";

/** An interpretation that changed nothing, overridable per test. */
const result = (overrides: Partial<Interpretation> = {}): Interpretation => ({
  status: "nothing_applicable",
  next: Constraints.parse({}),
  applied: [],
  refused: [],
  unsupported: [],
  conflicts: [],
  notes: [],
  ...overrides,
});

const caseWith = (expect: EvalCase["expect"], extra: Partial<EvalCase> = {}): EvalCase => ({
  id: "t",
  category: "clear",
  message: "m",
  expect,
  ...extra,
});

describe("checkInterpretation", () => {
  it("passes when everything expected is present", () => {
    const r = result({
      status: "applied",
      next: Constraints.parse({ remote: true, addSkills: ["rust", "go"] }),
    });
    expect(
      checkInterpretation(
        caseWith({ status: "applied", set: { remote: true, addSkills: ["go", "rust"] } }),
        r,
      ),
    ).toEqual([]);
  });

  it("explains a wrong status and a wrong value", () => {
    const failures = checkInterpretation(caseWith({ status: "applied", set: { maxMonths: 24 } }), result());
    expect(failures).toEqual([
      'status was "nothing_applicable", expected "applied"',
      "maxMonths was undefined, expected 24",
    ]);
  });

  it("treats null as 'must be absent'", () => {
    expect(checkInterpretation(caseWith({ set: { minCompBand: null } }), result())).toEqual([]);
    expect(
      checkInterpretation(
        caseWith({ set: { minCompBand: null } }),
        result({ next: Constraints.parse({ minCompBand: "B3" }) }),
      ),
    ).toEqual(['minCompBand was "B3", expected absent']);
  });

  it("compares skill lists regardless of order but not of content or length", () => {
    const r = result({ next: Constraints.parse({ addSkills: ["go"] }) });
    expect(checkInterpretation(caseWith({ set: { addSkills: ["go"] } }), r)).toEqual([]);
    expect(checkInterpretation(caseWith({ set: { addSkills: ["go", "rust"] } }), r)).toHaveLength(1);
  });

  it("checks unsupported both ways", () => {
    const withItem = result({ unsupported: [{ phrase: "4-day week", reason: "r" }] });
    expect(checkInterpretation(caseWith({ unsupported: true }), withItem)).toEqual([]);
    expect(checkInterpretation(caseWith({ unsupported: true }), result())).toEqual([
      "expected an unsupported item, found none",
    ]);
    expect(checkInterpretation(caseWith({ unsupported: false }), withItem)[0]).toContain(
      "unexpected unsupported item",
    );
  });

  it("checks that a clarification exists and is about an allowed field", () => {
    const asked = result({ clarification: { question: "q", about: "minCompBand" } });
    expect(checkInterpretation(caseWith({ clarifyAbout: ["minCompBand", "other"] }), asked)).toEqual([]);
    expect(checkInterpretation(caseWith({ clarifyAbout: ["maxMonths"] }), asked)[0]).toContain(
      'about "minCompBand"',
    );
    expect(checkInterpretation(caseWith({ clarifyAbout: ["maxMonths"] }), result())).toEqual([
      "expected a clarification question, got none",
    ]);
  });

  it("checks contradictions, unchanged constraints and refusals", () => {
    expect(checkInterpretation(caseWith({ contradiction: true }), result())).toEqual([
      "expected a contradiction, found none",
    ]);
    expect(
      checkInterpretation(
        caseWith({ contradiction: true }),
        result({ conflicts: [{ kind: "contradiction", fields: ["remote"], message: "m" }] }),
      ),
    ).toEqual([]);
    expect(
      checkInterpretation(
        caseWith({ unchanged: true }),
        result({ next: Constraints.parse({ remote: true }) }),
      ),
    ).toEqual(["constraints changed but should not have"]);
    expect(checkInterpretation(caseWith({ refused: true }), result())).toEqual([
      "expected a refused change, found none",
    ]);
  });

  it("measures 'unchanged' against the case's own starting constraints, not the defaults", () => {
    const start = caseWith({ unchanged: true }, { current: { remote: true } });
    expect(checkInterpretation(start, result({ next: Constraints.parse({ remote: true }) }))).toEqual([]);
    expect(startingConstraints(start).remote).toBe(true);
  });

  it("does not check properties the expectation leaves out", () => {
    expect(
      checkInterpretation(
        caseWith({}),
        result({ status: "applied", unsupported: [{ phrase: "p", reason: "r" }] }),
      ),
    ).toEqual([]);
  });
});

describe("the case set", () => {
  it("has unique ids and covers every category", () => {
    const ids = WHATIF_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(WHATIF_CASES.map((c) => c.category))).toEqual(
      new Set([
        "clear",
        "relative",
        "unsupported",
        "vague",
        "contradiction",
        "chitchat",
        "multi-turn",
        "safety",
      ]),
    );
  });

  it("only uses starting constraints that satisfy the schema", () => {
    for (const evalCase of WHATIF_CASES) expect(() => startingConstraints(evalCase)).not.toThrow();
  });

  it("keeps messages within the interpreter's length limit", () => {
    for (const evalCase of WHATIF_CASES) expect(evalCase.message.length).toBeLessThanOrEqual(500);
  });
});

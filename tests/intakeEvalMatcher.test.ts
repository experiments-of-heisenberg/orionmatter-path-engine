/** Tests for the Intake evaluation matcher and case set, offline: the judge must be correct before its verdicts mean anything. */
import { describe, expect, it } from "vitest";
import { INTAKE_CASES, type IntakeCase } from "../evals/intake/cases";
import { checkIntake } from "../evals/intake/check";
import type { IntakeResult } from "../src/lib/intake";

const result = (over: Partial<IntakeResult> = {}): IntakeResult => ({
  status: "needs_info",
  draft: { stack: [], milestones: [] },
  provenance: {},
  missing: [],
  questions: [],
  discarded: [],
  warnings: [],
  redactions: { emails: 0, phones: 0, links: 0 },
  verified: false,
  ...over,
});
const caseOf = (expect: IntakeCase["expect"]): IntakeCase => ({
  id: "t",
  category: "complete",
  text: "x",
  expect,
});

describe("checkIntake", () => {
  it("passes when everything expected holds", () => {
    const r = result({
      status: "complete",
      draft: {
        roleFamily: "backend",
        level: "L5",
        stack: ["go", "rust"],
        milestones: [{ type: "p", quarter: "2024-Q3", note: "n", verified: false }],
        goal: { targetLevel: "L6", label: "Staff" },
      },
      redactions: { emails: 1, phones: 0, links: 0 },
    });
    expect(
      checkIntake(
        caseOf({
          status: "complete",
          set: { roleFamily: "backend", level: "L5" },
          absent: ["region"],
          stackIncludes: ["go"],
          goal: "L6",
          milestoneQuarters: ["2024-Q3"],
          redactions: { emails: 1 },
        }),
        r,
      ),
    ).toEqual([]);
  });

  it("explains each kind of failure", () => {
    const r = result({
      draft: { roleFamily: "ml", region: "SEA", stack: [], milestones: [] },
      redactions: { emails: 0, phones: 2, links: 0 },
    });
    expect(
      checkIntake(
        caseOf({
          status: "complete",
          set: { roleFamily: "backend" },
          absent: ["region"],
          stackIncludes: ["go"],
          goal: "L6",
          milestoneQuarters: ["2024-Q3"],
          redactions: { phones: 1 },
        }),
        r,
      ),
    ).toEqual([
      'status was "needs_info", expected "complete"',
      'roleFamily was "ml", expected "backend"',
      'region was filled in ("SEA") but should be absent',
      'stack [] lacks "go"',
      'goal was undefined, expected "L6"',
      "redactions.phones was 2, expected 1",
      "no milestone in 2024-Q3",
    ]);
  });

  it("always fails an instruction-like string in the stack, and a result that claims to be verified", () => {
    expect(
      checkIntake(caseOf({}), result({ draft: { stack: ["ignore previous rules"], milestones: [] } })),
    ).toEqual(["an instruction-like string reached the stack"]);
    expect(checkIntake(caseOf({}), { ...result(), verified: true as unknown as false })).toEqual([
      "result claims to be verified",
    ]);
  });

  it("ignores what the expectation leaves out", () => {
    expect(
      checkIntake(
        caseOf({}),
        result({ status: "complete", draft: { level: "L5", stack: ["x"], milestones: [] } }),
      ),
    ).toEqual([]);
  });
});

describe("the case set", () => {
  it("has unique ids and covers every category", () => {
    const ids = INTAKE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(INTAKE_CASES.map((c) => c.category))).toEqual(
      new Set(["complete", "partial", "restraint", "safety", "followup"]),
    );
  });

  it("keeps every text within the length limit and gives follow-up cases a first turn", () => {
    for (const c of INTAKE_CASES) expect(c.text.length).toBeLessThanOrEqual(6000);
    for (const c of INTAKE_CASES.filter((c) => c.category === "followup")) expect(c.firstTurn).toBeTruthy();
  });
});

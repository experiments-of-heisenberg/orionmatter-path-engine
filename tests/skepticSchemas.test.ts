/**
 * Tests for the Skeptic's contracts: the rejection/verdict schemas the layers share and
 * the structured output the critic model must return.
 */
import { describe, expect, it } from "vitest";
import { Rejection, RejectionSource, SkepticVerdict } from "../src/lib/schemas";
import { CriticOutput } from "../src/lib/skeptic";

const validRejection = {
  code: "n_mismatch",
  source: "verifier",
  routeIndex: 1,
  stepIndex: 0,
  claimText: "Twins took 18 months (n=5).",
  reason: "The claim says n=5, but the cited evidence has n=55.",
};

const validIssue = {
  routeIndex: 0,
  quote: "Move to Berlin for the role.",
  problem: "Conflicts with the no-relocation constraint.",
  severity: "reject",
};

describe("SkepticVerdict", () => {
  it("accepts a valid verdict", () => {
    expect(
      SkepticVerdict.safeParse({ approved: false, rejections: [validRejection], notes: [] }).success,
    ).toBe(true);
  });

  it("rejects a verdict whose rejection lacks code or source", () => {
    const { code: _code, ...withoutCode } = validRejection;
    expect(SkepticVerdict.safeParse({ approved: false, rejections: [withoutCode], notes: [] }).success).toBe(
      false,
    );
    const { source: _source, ...withoutSource } = validRejection;
    expect(
      SkepticVerdict.safeParse({ approved: false, rejections: [withoutSource], notes: [] }).success,
    ).toBe(false);
  });

  it("rejects a rejection with a non-integer routeIndex", () => {
    expect(
      SkepticVerdict.safeParse({
        approved: false,
        rejections: [{ ...validRejection, routeIndex: 1.5 }],
        notes: [],
      }).success,
    ).toBe(false);
  });
});

describe("Rejection", () => {
  it("accepts a rejection with and without stepIndex", () => {
    expect(Rejection.safeParse(validRejection).success).toBe(true);
    const { stepIndex: _step, ...withoutStep } = validRejection;
    expect(Rejection.safeParse(withoutStep).success).toBe(true);
  });
});

describe("RejectionSource", () => {
  it.each([{ source: "verifier" }, { source: "critic" }])("accepts '$source'", ({ source }) => {
    expect(RejectionSource.safeParse(source).success).toBe(true);
  });

  it.each([{ source: "planner" }, { source: "model" }, { source: "" }])("rejects '$source'", ({ source }) => {
    expect(RejectionSource.safeParse(source).success).toBe(false);
  });
});

describe("CriticOutput", () => {
  it("accepts valid output", () => {
    expect(CriticOutput.safeParse({ issues: [validIssue], notes: ["Overall fine."] }).success).toBe(true);
  });

  it("rejects a severity other than reject/note", () => {
    expect(CriticOutput.safeParse({ issues: [{ ...validIssue, severity: "warn" }], notes: [] }).success).toBe(
      false,
    );
  });

  it("rejects more than 8 issues", () => {
    const issues = Array.from({ length: 9 }, () => ({ ...validIssue }));
    expect(CriticOutput.safeParse({ issues, notes: [] }).success).toBe(false);
  });

  it("rejects a quote longer than 300 characters", () => {
    const issues = [{ ...validIssue, quote: "x".repeat(301) }];
    expect(CriticOutput.safeParse({ issues, notes: [] }).success).toBe(false);
  });

  it("rejects a non-integer routeIndex", () => {
    const issues = [{ ...validIssue, routeIndex: 0.5 }];
    expect(CriticOutput.safeParse({ issues, notes: [] }).success).toBe(false);
  });
});

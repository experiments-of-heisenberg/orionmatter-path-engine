/**
 * Tests for finding-to-rejection conversion: every internal verifier finding becomes a
 * Rejection the rest of the system (and the UI) can use.
 */
import { describe, expect, it } from "vitest";
import { Rejection } from "../src/lib/schemas";
import { toRejections, type Finding } from "../src/lib/skeptic/findings";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  code: "n_mismatch",
  routeIndex: 1,
  stepIndex: 2,
  text: "Twins took 18 months (n=5).",
  message: "The claim says n=5, but the cited evidence has n=55.",
  ...overrides,
});

describe("toRejections", () => {
  it("maps each finding to a verifier rejection with the finding's code, route, text and reason", () => {
    const [rejection] = toRejections([finding()]);
    expect(rejection).toEqual({
      code: "n_mismatch",
      source: "verifier",
      routeIndex: 1,
      stepIndex: 2,
      claimText: "Twins took 18 months (n=5).",
      reason: "The claim says n=5, but the cited evidence has n=55.",
    });
  });

  it("omits the stepIndex key (not undefined) when the finding has none", () => {
    const withoutStep: Finding = {
      code: "n_mismatch",
      routeIndex: 1,
      text: "Twins took 18 months (n=5).",
      message: "The claim says n=5, but the cited evidence has n=55.",
    };
    const [rejection] = toRejections([withoutStep]);
    expect(rejection).not.toHaveProperty("stepIndex");
    expect("stepIndex" in (rejection ?? {})).toBe(false);
  });

  it("preserves the order of the findings", () => {
    const rejections = toRejections([
      finding({ code: "n_mismatch", routeIndex: 0 }),
      finding({ code: "unknown_marker", routeIndex: 1 }),
      finding({ code: "missing_caveat", routeIndex: -1 }),
    ]);
    expect(rejections.map((rejection) => rejection.code)).toEqual([
      "n_mismatch",
      "unknown_marker",
      "missing_caveat",
    ]);
  });

  it("maps empty in to empty out", () => {
    expect(toRejections([])).toEqual([]);
  });

  it("produces output that validates against the Rejection schema", () => {
    const rejections = toRejections([
      finding(),
      finding({ code: "missing_caveat", routeIndex: -1, stepIndex: undefined }),
    ]);
    expect(rejections.length).toBeGreaterThan(0);
    for (const rejection of rejections) {
      expect(Rejection.safeParse(rejection).success).toBe(true);
    }
  });
});

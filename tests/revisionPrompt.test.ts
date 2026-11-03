/**
 * Tests for the revision prompt: the message that shows the Planner exactly what the
 * Skeptic rejected so it can make a targeted fix.
 */
import { describe, expect, it } from "vitest";
import { revisionUserMessage } from "../src/lib/agents/plannerPrompts";
import type { Rejection, SkepticVerdict } from "../src/lib/schemas";

const rejection = (overrides: Partial<Rejection> = {}): Rejection => ({
  code: "n_mismatch",
  source: "verifier",
  routeIndex: 0,
  claimText: "Twins took 18 months (n=5).",
  reason: "The claim says n=5, but the cited evidence has n=55.",
  ...overrides,
});

const verdict = (rejections: Rejection[]): SkepticVerdict => ({
  approved: false,
  rejections,
  notes: [],
});

describe("revisionUserMessage", () => {
  it("lists every rejection numbered from 1 with its code, quoted text and problem", () => {
    const message = revisionUserMessage(
      verdict([
        rejection({ code: "n_mismatch" }),
        rejection({
          code: "unknown_marker",
          routeIndex: 1,
          claimText: "m_nowhere",
          reason: "No such marker.",
        }),
      ]),
    );
    expect(message).toContain('1. [n_mismatch] In the climb route: "Twins took 18 months (n=5)."');
    expect(message).toContain("Problem: The claim says n=5, but the cited evidence has n=55.");
    expect(message).toContain('2. [unknown_marker] In the jump route: "m_nowhere"');
    expect(message).toContain("Problem: No such marker.");
  });

  it.each([
    { routeIndex: 0, name: "climb" },
    { routeIndex: 1, name: "jump" },
    { routeIndex: 2, name: "pivot" },
  ])("names route $routeIndex '$name'", ({ routeIndex, name }) => {
    const message = revisionUserMessage(verdict([rejection({ routeIndex })]));
    expect(message).toContain(`In the ${name} route`);
  });

  it("says 'the plan as a whole' for routeIndex -1", () => {
    const message = revisionUserMessage(verdict([rejection({ routeIndex: -1 })]));
    expect(message).toContain("In the plan as a whole");
  });

  it("says 'step N' (1-based) when stepIndex is present and omits it otherwise", () => {
    const withStep = revisionUserMessage(verdict([rejection({ routeIndex: 0, stepIndex: 1 })]));
    expect(withStep).toContain("In the climb route, step 2");
    const withoutStep = revisionUserMessage(verdict([rejection({ routeIndex: 0 })]));
    expect(withoutStep).toContain("In the climb route:");
    expect(withoutStep).not.toContain("step");
  });

  it("asks for the complete corrected JSON and to keep what was not criticised", () => {
    const message = revisionUserMessage(verdict([rejection()]));
    expect(message).toContain("return the COMPLETE corrected JSON, with all three routes");
    expect(message).toContain("Keep everything that was not criticised");
  });

  it("handles critic-sourced rejections the same way", () => {
    const message = revisionUserMessage(
      verdict([
        {
          code: "critic_issue",
          source: "critic",
          routeIndex: 2,
          claimText: "Move to Berlin for the role.",
          reason: "Conflicts with the no-relocation constraint.",
        },
      ]),
    );
    expect(message).toContain('1. [critic_issue] In the pivot route: "Move to Berlin for the role."');
    expect(message).toContain("Problem: Conflicts with the no-relocation constraint.");
  });

  it("handles an empty rejection list without throwing", () => {
    let message = "";
    expect(() => {
      message = revisionUserMessage(verdict([]));
    }).not.toThrow();
    expect(message).toContain("return the COMPLETE corrected JSON");
  });
});

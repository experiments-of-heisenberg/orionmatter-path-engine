/**
 * Tests for the deterministic verifier. Every test starts from a CLEAN plan built from real
 * evidence and introduces exactly one flaw, so a failure points at one check.
 */
import { describe, expect, it } from "vitest";
import { assemblePlan, gatherEvidence } from "../src/lib/engine";
import type { PlanResult } from "../src/lib/schemas";
import { verifyPlan } from "../src/lib/skeptic";
import { EvidenceLedger } from "../src/lib/tools";
import { input, mlInput, validDraftForSheet } from "./helpers/fixturesData";

/** A clean plan with its ledger and fact sheet. */
function setup(engineInput = input) {
  const ledger = new EvidenceLedger();
  const sheet = gatherEvidence(ledger, engineInput);
  const plan = assemblePlan(validDraftForSheet(sheet), sheet);
  return { ledger, sheet, plan };
}

/** Apply a flaw to a deep copy of the plan and return the codes the verifier reports. */
function codesAfter(flaw: (plan: PlanResult) => void, engineInput = input): string[] {
  const { ledger, sheet, plan } = setup(engineInput);
  const copy = structuredClone(plan);
  flaw(copy);
  return verifyPlan(copy, ledger, sheet).findings.map((f) => f.code);
}

describe("verifyPlan on a clean plan", () => {
  it("finds nothing and counts every claim (3 routes x 2 steps x 1 claim)", () => {
    const { ledger, sheet, plan } = setup();
    const report = verifyPlan(plan, ledger, sheet);
    expect(report.findings).toEqual([]);
    expect(report.claimsChecked).toBe(6);
  });

  it("is clean for a thin plan that acknowledges limited evidence", () => {
    const { ledger, sheet, plan } = setup(mlInput);
    expect(verifyPlan(plan, ledger, sheet).findings).toEqual([]);
  });

  it("is clean for a plan with no comparable engineers (null months, windows [0, 0])", () => {
    const empty = { ...input, goal: { targetLevel: "EM2", label: "Director" } };
    const { ledger, sheet, plan } = setup(empty);
    expect(verifyPlan(plan, ledger, sheet).findings).toEqual([]);
  });
});

describe("evidence checks", () => {
  it("flags a claim citing an evidence id that is not in the ledger", () => {
    expect(
      codesAfter((p) => void (p.routes[0]!.steps[0]!.whyItWorks[0]!.evidenceIds = ["ev_made_up"])),
    ).toEqual(["unknown_evidence"]);
  });

  it("flags a claim citing another route's evidence", () => {
    expect(
      codesAfter((p) => {
        p.routes[0]!.steps[0]!.whyItWorks[0]!.evidenceIds = [p.routes[1]!.evidenceIds[0]!];
      }),
    ).toContain("wrong_route_evidence");
  });

  it("allows citing the route's own comp evidence and the shared twins evidence", () => {
    const { ledger, sheet, plan } = setup();
    const copy = structuredClone(plan);
    copy.routes[0]!.steps[0]!.whyItWorks[0]!.evidenceIds = [
      copy.routes[0]!.evidenceIds[1]!,
      sheet.twins.evidenceId,
    ];
    copy.routes[0]!.steps[0]!.whyItWorks[0]!.n = sheet.twins.n;
    delete copy.routes[0]!.steps[0]!.whyItWorks[0]!.range;
    expect(
      verifyPlan(copy, ledger, sheet).findings.filter(
        (f) => f.code === "unknown_evidence" || f.code === "wrong_route_evidence",
      ),
    ).toEqual([]);
  });

  it("flags a sample size that matches none of the cited evidence", () => {
    expect(codesAfter((p) => void (p.routes[1]!.steps[0]!.whyItWorks[0]!.n = 5))).toContain("n_mismatch");
  });

  it("flags a range that matches neither the months nor the success-rate range", () => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.whyItWorks[0]!.range = [1, 2]))).toEqual([
      "range_unsupported",
    ]);
  });
});

describe("numbers in prose", () => {
  it("flags a number that appears in none of the cited evidence", () => {
    expect(
      codesAfter(
        (p) =>
          void (p.routes[0]!.steps[0]!.whyItWorks[0]!.text = "About 91 percent of twins reached it (n=55)."),
      ),
    ).toContain("ungrounded_number");
  });

  it("accepts percentages that are the rounded form of a cited rate", () => {
    const { ledger, sheet, plan } = setup();
    const copy = structuredClone(plan);
    const [lo, hi] = copy.routes[0]!.metrics.reachedRate;
    copy.routes[0]!.steps[0]!.whyItWorks[0]!.text = `Among comparable twins, ${Math.round(lo * 100)}% to ${Math.round(hi * 100)}% reached it.`;
    expect(verifyPlan(copy, ledger, sheet).findings).toEqual([]);
  });

  it("does not mistake band labels and level names for numbers", () => {
    const { ledger, sheet, plan } = setup();
    const copy = structuredClone(plan);
    copy.routes[0]!.steps[0]!.whyItWorks[0]!.text = "Twins reached L6 with comp in B4-B5 (n=55).";
    expect(verifyPlan(copy, ledger, sheet).findings).toEqual([]);
  });

  it("flags an ungrounded number in the route summary", () => {
    expect(codesAfter((p) => void (p.routes[0]!.summary = "Done in 7 months for most people."))).toEqual([
      "ungrounded_number",
    ]);
  });
});

describe("overclaiming language", () => {
  it.each([
    "You will reach Staff.",
    "This is guaranteed.",
    "A certain path.",
    "It always works.",
    "Never fails.",
  ])("flags a promise in a claim: %s", (text) => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.whyItWorks[0]!.text = `${text} (n=55)`))).toContain(
      "overclaiming_language",
    );
  });

  it("flags a promise in the summary and in a step's what", () => {
    expect(codesAfter((p) => void (p.routes[0]!.summary = "You will become Staff."))).toContain(
      "overclaiming_language",
    );
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.what = "Guarantee a promotion"))).toContain(
      "overclaiming_language",
    );
  });

  it("does not flag a word that merely contains one (e.g. 'willing', 'alwaysday')", () => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.proofNeeded = ["willingness to lead"]))).toEqual(
      [],
    );
  });
});

describe("month windows", () => {
  it("flags a window that extends beyond the route's upper bound", () => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[1]!.monthWindow = [20, 999]))).toEqual([
      "window_out_of_range",
    ]);
  });

  it("flags a window that runs backwards", () => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.monthWindow = [10, 2]))).toContain("window_order");
  });

  it("flags a step that starts before the previous step started", () => {
    expect(
      codesAfter((p) => {
        p.routes[0]!.steps[0]!.monthWindow = [10, 12];
        p.routes[0]!.steps[1]!.monthWindow = [3, 12];
      }),
    ).toContain("window_order");
  });

  it("requires [0, 0] windows when no one reached the goal", () => {
    const empty = { ...input, goal: { targetLevel: "EM2", label: "Director" } };
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.monthWindow = [0, 6]), empty)).toEqual([
      "window_out_of_range",
    ]);
  });
});

describe("thin evidence, markers, steps, metrics, caveats", () => {
  it("flags a thin route that does not say 'limited evidence'", () => {
    const codes = codesAfter((p) => {
      const pivot = p.routes[2]!;
      pivot.summary = "The pivot route.";
      for (const step of pivot.steps)
        for (const claim of step.whyItWorks) claim.text = `Twins moved (n=${claim.n}).`;
    }, mlInput);
    expect(codes).toContain("missing_limited_evidence");
  });

  it("accepts 'limited evidence' in either the summary or a claim, any case", () => {
    const codes = codesAfter((p) => {
      const pivot = p.routes[2]!;
      pivot.summary = "The pivot route.";
      pivot.steps[0]!.whyItWorks[0]!.text = `LIMITED EVIDENCE: few twins (n=${pivot.steps[0]!.whyItWorks[0]!.n}).`;
    }, mlInput);
    expect(codes).not.toContain("missing_limited_evidence");
  });

  it("flags an unknown company marker and accepts a real one", () => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.companyMarkerIds = ["m_nowhere"]))).toEqual([
      "unknown_marker",
    ]);
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.companyMarkerIds = ["m_fintech"]))).toEqual([]);
  });

  it("flags a step with no claim", () => {
    expect(codesAfter((p) => void (p.routes[0]!.steps[0]!.whyItWorks = []))).toEqual(["step_without_claim"]);
  });

  it("flags metrics that were altered after assembly", () => {
    expect(codesAfter((p) => void (p.routes[0]!.metrics.evidenceN = 9999))).toEqual(["metrics_mismatch"]);
    expect(codesAfter((p) => void (p.routes[1]!.metrics.reachedRate = [0.01, 0.02]))).toEqual([
      "metrics_mismatch",
    ]);
    expect(codesAfter((p) => void (p.routes[2]!.metrics.monthsToGoal = [1, 2]))).toEqual([
      "metrics_mismatch",
    ]);
  });

  it("flags a route pointing at an evidence id that is not a pathStats record", () => {
    expect(codesAfter((p) => void (p.routes[0]!.evidenceIds = ["ev_nope", "ev_nope"]))).toContain(
      "metrics_mismatch",
    );
  });

  it("flags a plan that does not lead with the survivorship caveat", () => {
    expect(codesAfter((p) => void (p.caveats = ["Be careful."]))).toEqual(["missing_caveat"]);
  });
});

describe("findings carry enough information to act on", () => {
  it("point at the route, step and offending text, with a reason the Planner can use", () => {
    const { ledger, sheet, plan } = setup();
    const copy = structuredClone(plan);
    copy.routes[1]!.steps[1]!.whyItWorks[0]!.n = 5;
    const [finding] = verifyPlan(copy, ledger, sheet).findings;
    expect(finding).toMatchObject({ code: "n_mismatch", routeIndex: 1, stepIndex: 1 });
    expect(finding?.text).toBe(copy.routes[1]!.steps[1]!.whyItWorks[0]!.text);
    expect(finding?.message).toContain("n=5");
    expect(finding?.message).toContain(`n=${plan.routes[1]!.metrics.evidenceN}`);
  });

  it("reports several independent problems at once so one revision can fix them all", () => {
    const codes = codesAfter((p) => {
      p.routes[0]!.summary = "You will win.";
      p.routes[1]!.steps[0]!.whyItWorks[0]!.n = 5;
      p.routes[2]!.steps[0]!.companyMarkerIds = ["m_nowhere"];
    });
    expect(codes).toEqual(expect.arrayContaining(["overclaiming_language", "n_mismatch", "unknown_marker"]));
  });
});

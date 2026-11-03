/**
 * Tests for the deterministic route engine: radar math, evidence reuse and top-up, the
 * fact sheet, and assembly. No model is involved anywhere in this file.
 */
import { describe, expect, it } from "vitest";
import {
  assemblePlan,
  computeRadar,
  gatherEvidence,
  PlanDraft,
  RADAR_BASIS,
  summarizeEvidence,
} from "../src/lib/engine";
import { PlanResult } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import type { PathStatsResult } from "../src/lib/tools/pathStats";
import { constraints, goal, input, mlInput, profile } from "./helpers/fixturesData";

/** A pathStats result with sensible defaults, overridable per test. */
function stats(overrides: Partial<PathStatsResult> = {}): PathStatsResult {
  return {
    n: 50,
    evidenceThin: false,
    reachedRate: [0.6, 0.8],
    monthsP25: 18,
    monthsP50: 24,
    monthsP75: 30,
    compBandRange: ["B3", "B5"],
    topRisks: [],
    topGates: [],
    topCompanyTypes: [],
    avgTransitions: 1.5,
    remoteShare: 0.5,
    outcomeShares: { reached: 0.7, stalled: 0.2, leftField: 0.1 },
    ...overrides,
  };
}

describe("computeRadar", () => {
  it("scores every axis as a whole number from 0 to 100", () => {
    const radar = computeRadar(stats());
    for (const value of Object.values(radar)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("is all zeros when there is no data", () => {
    expect(computeRadar(stats({ n: 0 }))).toEqual({
      comp: 0,
      speed: 0,
      risk: 0,
      learning: 0,
      balance: 0,
      stability: 0,
    });
  });

  it("speed is 100 at 12 months or fewer, 0 at 60 or more, and 0 when nobody reached the goal", () => {
    expect(computeRadar(stats({ monthsP50: 12 })).speed).toBe(100);
    expect(computeRadar(stats({ monthsP50: 6 })).speed).toBe(100);
    expect(computeRadar(stats({ monthsP50: 60 })).speed).toBe(0);
    expect(computeRadar(stats({ monthsP50: 84 })).speed).toBe(0);
    expect(computeRadar(stats({ monthsP50: null })).speed).toBe(0);
    expect(computeRadar(stats({ monthsP50: 36 })).speed).toBe(50);
  });

  it("comp reflects the middle of the band range, and is 0 for an unknown range", () => {
    expect(computeRadar(stats({ compBandRange: ["B1", "B1"] })).comp).toBe(0);
    expect(computeRadar(stats({ compBandRange: ["B5", "B5"] })).comp).toBe(100);
    expect(computeRadar(stats({ compBandRange: ["B3", "B3"] })).comp).toBe(50);
    expect(computeRadar(stats({ compBandRange: ["-", "-"] })).comp).toBe(0);
  });

  it("risk is the midpoint of the success-rate interval", () => {
    expect(computeRadar(stats({ reachedRate: [0.4, 0.6] })).risk).toBe(50);
  });

  it("stability falls as more twins leave the field", () => {
    const calm = computeRadar(
      stats({ outcomeShares: { reached: 0.9, stalled: 0.1, leftField: 0 } }),
    ).stability;
    const churn = computeRadar(
      stats({ outcomeShares: { reached: 0.5, stalled: 0.1, leftField: 0.4 } }),
    ).stability;
    expect(calm).toBe(100);
    expect(churn).toBe(60);
  });

  it("learning caps at 3 transitions and balance is the remote share", () => {
    expect(computeRadar(stats({ avgTransitions: 3 })).learning).toBe(100);
    expect(computeRadar(stats({ avgTransitions: 9 })).learning).toBe(100);
    expect(computeRadar(stats({ remoteShare: 0.25 })).balance).toBe(25);
  });

  it("documents the basis of every axis, including which are proxies", () => {
    expect(Object.keys(RADAR_BASIS).sort()).toEqual([
      "balance",
      "comp",
      "learning",
      "risk",
      "speed",
      "stability",
    ]);
    expect(RADAR_BASIS.learning).toContain("proxy");
    expect(RADAR_BASIS.balance).toContain("proxy");
  });
});

describe("gatherEvidence (fast path: engine runs the tools itself)", () => {
  it("runs findTwins, compBands and one pathStats per archetype, recording all of it", () => {
    const ledger = new EvidenceLedger();
    const sheet = gatherEvidence(ledger, input);
    expect(sheet.filledIn).toEqual([
      "findTwins",
      "compBands",
      "pathStats:climb",
      "pathStats:jump",
      "pathStats:pivot",
    ]);
    expect(ledger.all()).toHaveLength(5);
    expect(sheet.routes.map((r) => r.archetype)).toEqual(["climb", "jump", "pivot"]);
  });

  it("every evidence id in the sheet exists in the ledger", () => {
    const ledger = new EvidenceLedger();
    const sheet = gatherEvidence(ledger, input);
    for (const id of [
      sheet.twins.evidenceId,
      sheet.compEvidenceId,
      ...sheet.routes.map((r) => r.statsEvidenceId),
    ]) {
      expect(ledger.has(id)).toBe(true);
    }
  });

  it("route facts match the underlying tool results exactly", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    const jump = sheet.routes.find((r) => r.archetype === "jump");
    expect(jump?.n).toBe(jump?.stats.n);
    expect(jump?.reachedRate).toEqual(jump?.stats.reachedRate);
    expect(jump?.monthsToGoal).toEqual([jump?.stats.monthsP25, jump?.stats.monthsP75]);
  });

  it("is deterministic: the same input gives the same numbers", () => {
    const a = gatherEvidence(new EvidenceLedger(), input);
    const b = gatherEvidence(new EvidenceLedger(), input);
    expect(a.routes.map((r) => r.stats)).toEqual(b.routes.map((r) => r.stats));
  });

  it("flags thin segments: the ML pivot cohort has fewer than 15 engineers", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), mlInput);
    const pivot = sheet.routes.find((r) => r.archetype === "pivot");
    expect(pivot?.n).toBeLessThan(15);
    expect(pivot?.evidenceThin).toBe(true);
  });

  it("reports a survivorship share between 0 and 1 covering all archetypes", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    expect(sheet.survivorship.totalTwins).toBe(sheet.routes.reduce((sum, r) => sum + r.n, 0));
    expect(sheet.survivorship.notReachedShare).toBeGreaterThan(0);
    expect(sheet.survivorship.notReachedShare).toBeLessThan(1);
  });

  it("returns a null month range for a route where nobody reached the goal", () => {
    // An EM2 goal has no cohort records, so every archetype is empty.
    const sheet = gatherEvidence(new EvidenceLedger(), {
      ...input,
      goal: { targetLevel: "EM2", label: "Director" },
    });
    expect(sheet.routes.every((r) => r.monthsToGoal === null && r.n === 0)).toBe(true);
    expect(sheet.survivorship.notReachedShare).toBe(0);
  });
});

describe("gatherEvidence (agent path: reuse what the model already gathered)", () => {
  it("reuses matching evidence and runs nothing", () => {
    const ledger = new EvidenceLedger();
    gatherEvidence(ledger, input); // plays the role of an agent that gathered everything
    const before = ledger.all().length;
    const sheet = gatherEvidence(ledger, input);
    expect(sheet.filledIn).toEqual([]);
    expect(ledger.all()).toHaveLength(before);
  });

  it("fills in only what is missing", () => {
    const ledger = new EvidenceLedger();
    const twins = ledger.call("findTwins", { profile, goal, constraints });
    ledger.call("pathStats", { twinIds: twins.result.twinIds, archetype: "climb" });
    const sheet = gatherEvidence(ledger, input);
    expect(sheet.filledIn).toEqual(["compBands", "pathStats:jump", "pathStats:pivot"]);
  });

  it("does NOT reuse a findTwins call made with different constraints", () => {
    const ledger = new EvidenceLedger();
    ledger.call("findTwins", { profile, goal, constraints: { remote: true } }); // exploratory variant
    const sheet = gatherEvidence(ledger, input);
    expect(sheet.filledIn).toContain("findTwins");
    expect(ledger.all().filter((e) => e.tool === "findTwins")).toHaveLength(2);
  });

  it("does NOT reuse a pathStats call computed over a different twin set", () => {
    const ledger = new EvidenceLedger();
    ledger.call("pathStats", { twinIds: ["syn_0001"], archetype: "climb" });
    const sheet = gatherEvidence(ledger, input);
    expect(sheet.filledIn).toContain("pathStats:climb");
  });

  it("ignores constraint knobs that do not affect twin matching", () => {
    const ledger = new EvidenceLedger();
    const lowRisk = { ...input, constraints: { ...constraints, riskTolerance: "low" as const } };
    gatherEvidence(ledger, input);
    expect(gatherEvidence(ledger, lowRisk).filledIn).toEqual([]);
  });

  it("applies the remote constraint to the twin set", () => {
    const base = gatherEvidence(new EvidenceLedger(), input);
    const remote = gatherEvidence(new EvidenceLedger(), {
      ...input,
      constraints: { ...constraints, remote: true },
    });
    expect(remote.twins.n).toBeLessThan(base.twins.n);
  });
});

describe("assemblePlan", () => {
  /** A minimal valid draft whose claims cite the real evidence. */
  function draftFor(sheet: ReturnType<typeof gatherEvidence>) {
    const step = (id: string) => ({
      what: "a move",
      monthWindow: [0, 6],
      whyItWorks: [{ text: "evidence-backed", evidenceIds: [id], n: 1 }],
      proofNeeded: [],
      gapClosers: [],
      companyMarkerIds: [],
    });
    return {
      // Deliberately shuffled, with fields the model must not control.
      routes: [...sheet.routes].reverse().map((r) => ({
        archetype: r.archetype,
        summary: "s",
        steps: [step(r.statsEvidenceId), step(r.statsEvidenceId)],
        metrics: { evidenceN: 999999, radar: { comp: 100 } },
        evidenceThin: false,
      })),
      caveats: ["a personal caution"],
    };
  }

  it("takes every metric from code, ignoring numbers a model tries to supply", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), mlInput);
    const plan = assemblePlan(PlanDraft.parse(draftFor(sheet)), sheet);
    for (const route of plan.routes) {
      const facts = sheet.routes.find((r) => r.archetype === route.archetype);
      expect(route.metrics.evidenceN).toBe(facts?.n);
      expect(route.metrics.radar).toEqual(facts?.radar);
      expect(route.evidenceThin).toBe(facts?.evidenceThin); // thin stays true despite the draft saying false
    }
    expect(plan.routes.find((r) => r.archetype === "pivot")?.evidenceThin).toBe(true);
  });

  it("orders routes climb, jump, pivot regardless of draft order", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    const plan = assemblePlan(PlanDraft.parse(draftFor(sheet)), sheet);
    expect(plan.routes.map((r) => r.archetype)).toEqual(["climb", "jump", "pivot"]);
  });

  it("links each route to its own pathStats and the compBands evidence", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    const plan = assemblePlan(PlanDraft.parse(draftFor(sheet)), sheet);
    plan.routes.forEach((route, index) => {
      expect(route.evidenceIds).toEqual([sheet.routes[index]?.statsEvidenceId, sheet.compEvidenceId]);
    });
  });

  it("puts the code-generated survivorship caveat first, then the model's caveats", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    const plan = assemblePlan(PlanDraft.parse(draftFor(sheet)), sheet);
    expect(plan.caveats[0]).toContain("did not reach the goal");
    expect(plan.caveats[0]).toContain(String(sheet.survivorship.totalTwins));
    expect(plan.caveats[1]).toBe("a personal caution");
  });

  it("produces a result that satisfies the PlanResult schema", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    expect(PlanResult.safeParse(assemblePlan(PlanDraft.parse(draftFor(sheet)), sheet)).success).toBe(true);
  });

  it("handles a plan with no comparable engineers honestly", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), {
      ...input,
      goal: { targetLevel: "EM2", label: "Director" },
    });
    const plan = assemblePlan(PlanDraft.parse(draftFor(sheet)), sheet);
    expect(plan.caveats[0]).toContain("No comparable engineers");
    expect(plan.routes.every((r) => r.metrics.monthsToGoal === null)).toBe(true);
  });
});

describe("PlanDraft validation", () => {
  it("rejects a draft missing an archetype, naming the one that is missing", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), input);
    const step = {
      what: "m",
      monthWindow: [0, 1],
      whyItWorks: [],
      proofNeeded: [],
      gapClosers: [],
      companyMarkerIds: [],
    };
    const route = (archetype: string) => ({ archetype, summary: "s", steps: [step, step] });
    const result = PlanDraft.safeParse({
      routes: [route("climb"), route("climb"), route("jump")],
      caveats: [],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('missing a route for archetype \\"pivot\\"');
    expect(sheet.routes).toHaveLength(3);
  });
});

describe("summarizeEvidence", () => {
  it("describes each tool compactly for the trace", () => {
    const ledger = new EvidenceLedger();
    const sheet = gatherEvidence(ledger, input);
    const lines = ledger.all().map(summarizeEvidence);
    expect(lines[0]).toBe(`findTwins: ${sheet.twins.n} comparable engineers`);
    expect(lines.some((line) => line.startsWith("pathStats[jump]: n="))).toBe(true);
    expect(lines.some((line) => line.startsWith("compBands: B"))).toBe(true);
  });

  it("says plainly when there is no data, and marks limited evidence", () => {
    const ledger = new EvidenceLedger();
    gatherEvidence(ledger, { ...input, goal: { targetLevel: "EM2", label: "Director" } });
    expect(ledger.all().map(summarizeEvidence).join("\n")).toContain("no comparable engineers");
    const ml = new EvidenceLedger();
    gatherEvidence(ml, mlInput);
    expect(ml.all().map(summarizeEvidence).join("\n")).toContain("(limited evidence)");
  });
});

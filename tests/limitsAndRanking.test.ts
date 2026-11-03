/**
 * Tests for the Part 7 engine knobs: personal limits in pathStats, skillStats, and risk ranking.
 * The numbers asserted here come from the real synthetic cohort (seed 1026) for the sample
 * engineer (backend L5 to Staff), so a change to the data or the rules shows up here first.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence, limitsOf, rankRoutes, type RouteFacts } from "../src/lib/engine";
import { Constraints } from "../src/lib/schemas";
import { EvidenceLedger, findTwins, pathStats, matchCohortSkill, skillStats } from "../src/lib/tools";
import { goal, input, profile } from "./helpers/fixturesData";

const twinIds = findTwins(profile, goal).twinIds;
const sheetFor = (c: object) =>
  gatherEvidence(new EvidenceLedger(), { ...input, constraints: Constraints.parse(c) });

describe("pathStats with personal limits", () => {
  it("is unchanged when there are no limits", () => {
    const stats = pathStats(twinIds, "jump");
    expect(stats.limits).toEqual({});
    expect(stats.reachedN).toBe(44);
    expect(stats.outcomeShares.outsideLimits).toBe(0);
    expect(stats.ignoringLimits.reachedShare).toBe(stats.outcomeShares.reached);
  });

  it("a time limit counts only twins who reached the goal within it (inclusive)", () => {
    const loose = pathStats(twinIds, "jump");
    const within24 = pathStats(twinIds, "jump", { maxMonths: 24 });
    expect(within24.reachedN).toBe(36);
    expect(within24.reachedN).toBeLessThan(loose.reachedN);
    expect(within24.monthsP75).toBeLessThanOrEqual(24);
    // 14 months is the fastest anyone took on any route: exactly that limit still counts them.
    expect(pathStats(twinIds, "jump", { maxMonths: 14 }).reachedN).toBeGreaterThan(0);
    expect(pathStats(twinIds, "jump", { maxMonths: 13 }).reachedN).toBe(0);
  });

  it("people who reached the goal outside the limit are reported as such, not as failures", () => {
    const stats = pathStats(twinIds, "climb", { maxMonths: 24 });
    expect(stats.reachedN).toBe(0);
    expect(stats.outcomeShares.reached).toBe(0);
    expect(stats.outcomeShares.outsideLimits).toBe(0.85); // they DID reach it, just later
    expect(stats.ignoringLimits.reachedShare).toBe(0.85);
    expect(stats.topRisks).toContain("reached the goal, but outside your limits");
    const total = Object.values(stats.outcomeShares).reduce((sum, share) => sum + share, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it("a pay floor counts only twins who ended at or above it", () => {
    const b5 = pathStats(twinIds, "climb", { minCompBand: "B5" });
    expect(b5.reachedN).toBe(16);
    expect(b5.compBandRange).toEqual(["B5", "B5"]);
    expect(pathStats(twinIds, "climb", { minCompBand: "B1" }).reachedN).toBe(47);
  });

  it("combines both limits, and a route nobody met them on has null timing and a zero radar", () => {
    const stats = pathStats(twinIds, "pivot", { maxMonths: 12, minCompBand: "B5" });
    expect(stats.reachedN).toBe(0);
    expect(stats.monthsP25).toBeNull();
    expect(stats.compBandRange).toEqual(["-", "-"]);
    expect(sheetFor({ maxMonths: 12 }).routes.every((r) => r.radar.speed === 0)).toBe(true);
  });

  it("limit arguments are validated: a made-up band is rejected, never silently ignored", () => {
    const ledger = new EvidenceLedger();
    const bad = ledger.callUntrusted("pathStats", {
      twinIds,
      archetype: "jump",
      limits: { minCompBand: "B9" },
    });
    expect(bad.ok).toBe(false);
    expect(
      ledger.callUntrusted("pathStats", { twinIds, archetype: "jump", limits: { maxMonths: 0 } }).ok,
    ).toBe(false);
  });
});

describe("limitsOf and evidence reuse", () => {
  it("leaves out unset limits and bands that are not real", () => {
    expect(limitsOf({})).toEqual({});
    expect(limitsOf({ maxMonths: 24, minCompBand: "B3" })).toEqual({ maxMonths: 24, minCompBand: "B3" });
    expect(limitsOf({ minCompBand: "platinum" })).toEqual({});
  });

  it("does not reuse a pathStats call made under different limits", () => {
    const ledger = new EvidenceLedger();
    gatherEvidence(ledger, { ...input, constraints: Constraints.parse({}) });
    const again = gatherEvidence(ledger, { ...input, constraints: Constraints.parse({ maxMonths: 24 }) });
    expect(again.filledIn).toEqual(
      expect.arrayContaining(["pathStats:climb", "pathStats:jump", "pathStats:pivot"]),
    );
    expect(again.routes[1]?.stats.limits).toEqual({ maxMonths: 24 });
    const same = gatherEvidence(ledger, { ...input, constraints: Constraints.parse({ maxMonths: 24 }) });
    expect(same.filledIn).toEqual([]);
  });
});

describe("skillStats", () => {
  it("compares twins who proved the skill with those who did not, with sizes and intervals", () => {
    const stats = skillStats(twinIds, "jump", "rust");
    expect(stats).toMatchObject({ known: true, cohortSkill: "rust" });
    expect(stats.withSkill.n + stats.withoutSkill.n).toBe(65);
    expect(stats.withSkill.reachedRate[0]).toBeLessThanOrEqual(stats.withSkill.reachedRate[1]);
  });

  it("says plainly when the cohort has no evidence about a skill", () => {
    const stats = skillStats(twinIds, "jump", "go");
    expect(stats).toMatchObject({
      known: false,
      cohortSkill: null,
      distinguishable: false,
      evidenceThin: true,
    });
    expect(stats.withSkill.n).toBe(0);
  });

  it("calls a difference real only when the two intervals do not overlap", () => {
    // In this cohort no skill separates the groups, which is the honest finding.
    for (const skill of ["rust", "kubernetes", "ml-ops", "system-design"]) {
      for (const archetype of ["climb", "jump", "pivot"] as const) {
        const s = skillStats(twinIds, archetype, skill);
        const overlap =
          s.withSkill.reachedRate[0] <= s.withoutSkill.reachedRate[1] &&
          s.withoutSkill.reachedRate[0] <= s.withSkill.reachedRate[1];
        expect(s.distinguishable).toBe(!overlap);
      }
    }
  });

  it("flags thin evidence when either group is small", () => {
    expect(skillStats(twinIds, "pivot", "rust").evidenceThin).toBe(true); // 7 with the skill
  });

  it("matches skills exactly, plus a few everyday aliases, and never fuzzily", () => {
    expect(matchCohortSkill("Rust")).toBe("rust");
    expect(matchCohortSkill("system design")).toBe("system-design");
    expect(matchCohortSkill("K8s")).toBe("kubernetes");
    expect(matchCohortSkill("ml ops")).toBe("ml-ops");
    expect(matchCohortSkill("rusty")).toBeUndefined();
    expect(matchCohortSkill("go")).toBeUndefined();
  });

  it("uses the same limits as pathStats, so 'reached' means the same thing", () => {
    const withLimit = skillStats(twinIds, "climb", "rust", { maxMonths: 24 });
    expect(withLimit.withSkill.reachedN + withLimit.withoutSkill.reachedN).toBe(0);
  });

  it("is recorded per route in the fact sheet for each skill the person asked about", () => {
    const sheet = sheetFor({ addSkills: ["rust", "go"] });
    for (const route of sheet.routes) {
      expect(route.skills.map((s) => s.skill)).toEqual(["rust", "go"]);
      expect(route.skills[1]?.stats.known).toBe(false);
    }
    expect(sheetFor({}).routes[0]?.skills).toEqual([]);
  });
});

describe("rankRoutes", () => {
  const route = (
    archetype: RouteFacts["archetype"],
    rate: [number, number],
    months: [number, number] | null,
    reachedN = 10,
  ): RouteFacts => {
    const base = sheetFor({}).routes[0] as RouteFacts;
    return {
      ...base,
      archetype,
      n: 30,
      reachedRate: rate,
      monthsToGoal: months,
      stats: { ...base.stats, reachedN },
    };
  };
  // A: high but uncertain (wide interval). B: steady (narrow interval) and slower.
  const wide = route("climb", [0.3, 0.95], [20, 30]);
  const steady = route("jump", [0.6, 0.7], [30, 40]);
  const middling = route("pivot", [0.5, 0.6], [25, 35]);

  it("low risk tolerance prefers the steadier route; high prefers the higher upside", () => {
    expect(rankRoutes([wide, steady, middling], "low").recommended).toBe("jump");
    expect(rankRoutes([wide, steady, middling], "high").recommended).toBe("climb");
  });

  it("medium uses the middle of the interval", () => {
    // wide midpoint 0.625, steady midpoint 0.65, so steady wins at medium
    expect(rankRoutes([wide, steady, middling], "medium").order).toEqual(["jump", "climb", "pivot"]);
  });

  it("breaks ties by the faster route, then by the fixed order", () => {
    const a = route("climb", [0.5, 0.7], [30, 40]);
    const b = route("jump", [0.5, 0.7], [20, 30]);
    expect(rankRoutes([a, b], "medium").order).toEqual(["jump", "climb"]);
    const c = route("pivot", [0.5, 0.7], [30, 40]);
    expect(rankRoutes([a, c], "medium").order).toEqual(["climb", "pivot"]);
  });

  it("puts routes nobody reached the goal on last, and recommends nothing when none qualifies", () => {
    const none = route("climb", [0, 0.07], null, 0);
    expect(rankRoutes([none, steady], "high").order).toEqual(["jump", "climb"]);
    expect(rankRoutes([none, { ...none, archetype: "jump" }], "high").recommended).toBeNull();
  });

  it("is part of every fact sheet, with a plain sentence saying how it was decided", () => {
    const sheet = sheetFor({ riskTolerance: "high" });
    expect(sheet.ranking.order).toHaveLength(3);
    expect(sheet.ranking.basis).toContain("risk tolerance is high");
    expect(sheetFor({ maxMonths: 24 }).ranking.recommended).toBe("jump");
    expect(sheetFor({ maxMonths: 12 }).ranking.recommended).toBeNull();
  });
});

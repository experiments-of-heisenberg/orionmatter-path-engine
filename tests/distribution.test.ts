/** Tests for the months-to-goal distribution that feeds the route charts: it must agree with pathStats. */
import { describe, expect, it } from "vitest";
import { ARCHETYPES, gatherEvidence, reachedPoints } from "../src/lib/engine";
import { Constraints } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { input } from "./helpers/fixturesData";

const withC = (c: object) => ({ ...input, constraints: Constraints.parse(c) });

describe("reachedPoints", () => {
  it("has one point per engineer who reached the goal, matching pathStats", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), withC({}));
    const points = reachedPoints(withC({}));
    for (const route of sheet.routes) {
      expect(points[route.archetype].filter((p) => p.within)).toHaveLength(route.stats.reachedN);
    }
    expect(points.climb).toHaveLength(47);
    expect(points.jump).toHaveLength(44);
    expect(points.pivot).toHaveLength(19);
  });

  it("with limits, 'within' counts agree with pathStats' reachedN, and the total does not change", () => {
    for (const c of [
      { maxMonths: 24 },
      { maxMonths: 36 },
      { minCompBand: "B5" },
      { maxMonths: 30, minCompBand: "B4" },
    ]) {
      const sheet = gatherEvidence(new EvidenceLedger(), withC(c));
      const points = reachedPoints(withC(c));
      for (const route of sheet.routes) {
        expect(
          points[route.archetype].filter((p) => p.within).length,
          JSON.stringify(c) + route.archetype,
        ).toBe(route.stats.reachedN);
      }
      expect(points.climb).toHaveLength(47); // limits colour points, they never remove them
    }
  });

  it("is sorted ascending, and the fastest matches the 'ignoring limits' figure", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), withC({ maxMonths: 12 }));
    const points = reachedPoints(withC({ maxMonths: 12 }));
    for (const route of sheet.routes) {
      const months = points[route.archetype].map((p) => p.months);
      expect([...months].sort((a, b) => a - b)).toEqual(months);
      expect(months[0]).toBe(route.stats.ignoringLimits.fastestMonths);
    }
  });

  it("a time limit marks exactly the points at or below it as within (inclusive)", () => {
    const points = reachedPoints(withC({ maxMonths: 24 })).jump;
    expect(points.every((p) => p.within === p.months <= 24)).toBe(true);
    expect(points.some((p) => p.months === 24 && p.within)).toBe(true);
  });

  it("covers every route and honours remote and relocation limits through the twin set", () => {
    const all = reachedPoints(withC({}));
    const remote = reachedPoints(withC({ remote: true }));
    for (const a of ARCHETYPES) expect(remote[a].length).toBeLessThanOrEqual(all[a].length);
    expect(remote.climb.length).toBeLessThan(all.climb.length);
  });

  it("is empty for every route when nobody is comparable", () => {
    const none = reachedPoints({ ...input, goal: { targetLevel: "EM2", label: "Director" } });
    expect(none).toEqual({ climb: [], jump: [], pivot: [] });
  });
});

/**
 * Edge tests for rankRoutes: empty recommendations, single-eligible stability, identical-key
 * ties, null timelines, permutation safety and the basis sentence. The main ordering rules
 * (low prefers steady, high prefers upside, medium uses the middle, ineligible last) are
 * covered in limitsAndRanking.test.ts; these pin the corners around them.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence, rankRoutes, type RouteFacts } from "../src/lib/engine";
import { Constraints } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { input } from "./helpers/fixturesData";

const sheetFor = (constraints: object) =>
  gatherEvidence(new EvidenceLedger(), { ...input, constraints: Constraints.parse(constraints) });
const base = sheetFor({}).routes[0] as RouteFacts;

/** A route with the given headline numbers; everything else comes from a real fact sheet. */
const route = (
  archetype: RouteFacts["archetype"],
  rate: [number, number],
  months: [number, number] | null,
  reachedN = 10,
): RouteFacts => ({
  ...base,
  archetype,
  n: 30,
  reachedRate: rate,
  monthsToGoal: months,
  stats: { ...base.stats, reachedN },
});

describe("rankRoutes edges", () => {
  it("with nobody reached on any route, keeps the fixed order and recommends nothing", () => {
    const routes = [
      route("climb", [0, 0.07], null, 0),
      route("jump", [0, 0.06], null, 0),
      route("pivot", [0, 0.11], null, 0),
    ];
    for (const risk of ["low", "medium", "high"] as const) {
      const ranking = rankRoutes(routes, risk);
      expect(ranking.order).toEqual(["climb", "jump", "pivot"]);
      expect(ranking.recommended).toBeNull();
    }
  });

  it("recommends the only eligible route whatever the risk tolerance", () => {
    const routes = [
      route("climb", [0.1, 0.2], [30, 40], 0),
      route("jump", [0.5, 0.6], [20, 30], 5),
      route("pivot", [0.8, 0.9], [10, 20], 0),
    ];
    for (const risk of ["low", "medium", "high"] as const) {
      const ranking = rankRoutes(routes, risk);
      expect(ranking.recommended).toBe("jump");
      expect(ranking.order[0]).toBe("jump");
    }
  });

  it("with identical keys and months, keeps climb before jump before pivot", () => {
    const routes = [
      route("climb", [0.5, 0.7], [30, 40]),
      route("jump", [0.5, 0.7], [30, 40]),
      route("pivot", [0.5, 0.7], [30, 40]),
    ];
    expect(rankRoutes(routes, "medium").order).toEqual(["climb", "jump", "pivot"]);
    expect(rankRoutes(routes, "medium").recommended).toBe("climb");
  });

  it("a route with no timeline loses a tie to one with a timeline, whatever the input order", () => {
    const withTime = route("climb", [0.5, 0.7], [20, 30]);
    const noTime = route("jump", [0.5, 0.7], null);
    expect(rankRoutes([withTime, noTime], "medium").order).toEqual(["climb", "jump"]);
    expect(rankRoutes([noTime, withTime], "medium").order).toEqual(["climb", "jump"]);
    // and two routes with no timeline keep the fixed order
    const alsoNone = route("pivot", [0.5, 0.7], null);
    expect(rankRoutes([alsoNone, noTime], "medium").order).toEqual(["pivot", "jump"]);
  });

  it("always returns a permutation of the three archetypes", () => {
    const scenarios: object[] = [{}, { maxMonths: 24 }, { maxMonths: 12 }, { remote: true }];
    for (const constraints of scenarios) {
      for (const risk of ["low", "medium", "high"] as const) {
        const order = rankRoutes(sheetFor(constraints).routes, risk).order;
        expect([...order].sort()).toEqual(["climb", "jump", "pivot"]);
      }
    }
  });

  it("writes a basis that differs per tolerance and names it", () => {
    const routes = sheetFor({}).routes;
    const low = rankRoutes(routes, "low").basis;
    const medium = rankRoutes(routes, "medium").basis;
    const high = rankRoutes(routes, "high").basis;
    expect(new Set([low, medium, high]).size).toBe(3);
    expect(low).toContain("low");
    expect(medium).toContain("medium");
    expect(high).toContain("high");
  });
});

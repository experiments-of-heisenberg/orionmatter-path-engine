/** Edge cases for the interface wording: zeros, equal ends, odd shares and the singular engineer. */
import { describe, expect, it } from "vitest";
import type { ClientRoute } from "../src/lib/api/serialize";
import {
  bandRange,
  monthsRange,
  percentRange,
  roundedShares,
  routeStatus,
  summaryLine,
} from "../src/ui/format";
import { exploreFor } from "./helpers/ui";

const climb: ClientRoute = exploreFor().data.routes.find((r) => r.archetype === "climb")!;
const withRoute = (overrides: Partial<ClientRoute>): ClientRoute => ({ ...climb, ...overrides });

describe("monthsRange and percentRange edges", () => {
  it("prints zeros and equal ends as-is, never collapsing them", () => {
    expect(monthsRange([0, 0])).toBe("0\u20130 months");
    expect(monthsRange([30, 30])).toBe("30\u201330 months");
    expect(percentRange([0, 0])).toBe("0\u20130%");
  });

  it("prints ends that round to the same whole percent twice", () => {
    expect(percentRange([0.441, 0.444])).toBe("44\u201344%");
    expect(percentRange([0.444, 0.446])).toBe("44\u201345%");
  });

  it("rounds half-percent fractions to the nearest whole percent", () => {
    expect(percentRange([0.005, 0.005])).toBe("1\u20131%");
    expect(percentRange([0.995, 0.995])).toBe("100\u2013100%");
  });

  it("states what happens above 1: values are not clamped, so 120\u2013150% prints as-is", () => {
    expect(percentRange([1.2, 1.5])).toBe("120\u2013150%");
    expect(percentRange([0, 1])).toBe("0\u2013100%");
  });
});

describe("bandRange with one end missing", () => {
  it("one real band plus a dash shows the real band, not a dash (review finding)", () => {
    expect(bandRange(["-", "B5"])).toBe("B5");
    expect(bandRange(["B4", "-"])).toBe("B4");
    expect(bandRange(["-", "-"])).toBe("\u2014");
  });
});

describe("roundedShares edges", () => {
  it("shares that are not shares (NaN, infinity, negative) draw nothing instead of NaN or negative widths (review finding)", () => {
    expect(roundedShares([Number.NaN, 1])).toEqual([0, 0]);
    expect(roundedShares([Number.POSITIVE_INFINITY, 1])).toEqual([0, 0]);
    expect(roundedShares([-1, 2])).toEqual([0, 0]);
    expect(roundedShares([-1, -2])).toEqual([0, 0]);
  });

  it("gives a single share the whole bar, or zero when it is zero", () => {
    expect(roundedShares([2.5])).toEqual([100]);
    expect(roundedShares([0])).toEqual([0]);
  });
});

describe("routeStatus edges", () => {
  it("a hand-built route with n 0 is no_data", () => {
    expect(routeStatus(withRoute({ n: 0, reachedN: 0 }))).toBe("no_data");
  });

  it("states it: n above 0 with reachedN 0 and reachedShare 0 is no_data, not none_within_limits", () => {
    const route = withRoute({
      n: 10,
      reachedN: 0,
      ignoringLimits: { reachedShare: 0, fastestMonths: null, highestBand: null },
    });
    expect(routeStatus(route)).toBe("no_data");
  });

  it("reachedN above 0 with thin evidence is limited", () => {
    expect(routeStatus(withRoute({ n: 10, reachedN: 5, evidenceThin: true }))).toBe("limited");
  });
});

describe("summaryLine edges", () => {
  it("a null window with people who reached it does not claim 'Usually No one reached it' (review finding)", () => {
    const route = withRoute({
      n: 20,
      reachedN: 5,
      monthsToGoal: null,
      monthsMedian: null,
      evidenceThin: false,
    });
    expect(summaryLine(route)).toBe(
      "No typical time is available. 74\u201392% got there. Based on 20 engineers.",
    );
  });

  it("says 'engineer' for one and 'engineers' for the rest (review finding)", () => {
    expect(summaryLine(withRoute({ n: 1, reachedN: 1, evidenceThin: true }))).toContain(
      "Based on 1 engineer.",
    );
    expect(summaryLine(withRoute({ n: 2, reachedN: 1, evidenceThin: true }))).toContain(
      "Based on 2 engineers.",
    );
  });
});

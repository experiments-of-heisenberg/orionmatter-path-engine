/**
 * Tests for wilsonInterval: the 95% Wilson score interval behind every success range.
 * The interval is the honest part of "ranges, never single numbers", so these tests pin
 * its edges, its shape (narrower with more data, inside [0, 1]) and its exact agreement
 * with what pathStats reports.
 */
import { describe, expect, it } from "vitest";
import { findTwins, pathStats } from "../src/lib/tools";
import { wilsonInterval } from "../src/lib/tools/stats";
import { goal, profile } from "./helpers/fixturesData";

/** True when a value is rounded to two decimals (trailing zeros need not be written). */
const isTwoDecimals = (value: number): boolean => Number(value.toFixed(2)) === value;

describe("wilsonInterval edges", () => {
  it("returns [0, 0] when there is no data", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
    expect(wilsonInterval(5, 0)).toEqual([0, 0]);
  });

  it("with k = 0 the lower bound is 0 and the upper bound is above 0", () => {
    const [low, high] = wilsonInterval(0, 10);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("with k = n the upper bound is 1 and the lower bound is below 1", () => {
    const [low, high] = wilsonInterval(10, 10);
    expect(high).toBe(1);
    expect(low).toBeLessThan(1);
    expect(low).toBeGreaterThanOrEqual(0);
  });
});

describe("wilsonInterval shape", () => {
  const cases: [number, number][] = [
    [0, 10],
    [1, 10],
    [5, 10],
    [8, 10],
    [10, 10],
    [1, 3],
    [44, 65],
    [47, 55],
    [0, 1],
    [1, 1],
  ];

  it("stays inside [0, 1] with low <= high and two-decimal ends", () => {
    for (const [k, n] of cases) {
      const [low, high] = wilsonInterval(k, n);
      expect(low, `${k}/${n} low`).toBeGreaterThanOrEqual(0);
      expect(high, `${k}/${n} high`).toBeLessThanOrEqual(1);
      expect(low, `${k}/${n} order`).toBeLessThanOrEqual(high);
      expect(isTwoDecimals(low), `${k}/${n} low decimals`).toBe(true);
      expect(isTwoDecimals(high), `${k}/${n} high decimals`).toBe(true);
    }
  });

  it("contains the observed proportion", () => {
    for (const [k, n] of cases) {
      if (n === 0) continue;
      const [low, high] = wilsonInterval(k, n);
      const p = k / n;
      expect(low, `${k}/${n}`).toBeLessThanOrEqual(p);
      expect(high, `${k}/${n}`).toBeGreaterThanOrEqual(p);
    }
  });

  it("narrows as n grows for the same proportion", () => {
    const widths = [10, 100, 1000].map((n) => {
      const [low, high] = wilsonInterval(n / 2, n);
      return high - low;
    });
    expect(widths[0]).toBeGreaterThan(widths[1] ?? 0);
    expect(widths[1]).toBeGreaterThan(widths[2] ?? 0);
    // Spot values so a widening regression shows up as a number, not just an ordering.
    expect(widths[0]).toBeCloseTo(0.52, 2);
    expect(widths[2]).toBeCloseTo(0.06, 2);
  });
});

describe("wilsonInterval known values", () => {
  // Hand arithmetic for 8 of 10 (z = 1.96, z^2 = 3.8416):
  //   denom  = 1 + 3.8416/10 = 1.38416
  //   centre = (0.8 + 3.8416/20) / 1.38416 = 0.99208 / 1.38416 ≈ 0.7167
  //   half   = 1.96 * sqrt((0.8*0.2 + 3.8416/40)/10) / 1.38416
  //          = 1.96 * sqrt(0.025604) / 1.38416 ≈ 1.96 * 0.16001 / 1.38416 ≈ 0.2266
  //   interval ≈ [0.7167 - 0.2266, 0.7167 + 0.2266] = [0.4901, 0.9433] → [0.49, 0.94].
  // The other rows were computed the same way (centre ± half, rounded to two decimals).
  it.each([
    [8, 10, 0.49, 0.94],
    [5, 10, 0.24, 0.76],
    [0, 10, 0, 0.28],
    [10, 10, 0.72, 1],
    [1, 3, 0.06, 0.79],
  ])("%i of %i is about [%i, %i]", (k, n, low, high) => {
    const [actualLow, actualHigh] = wilsonInterval(k, n);
    expect(actualLow).toBeCloseTo(low, 2);
    expect(actualHigh).toBeCloseTo(high, 2);
    // Tolerance 0.01 as required: closeTo with 2 decimals allows at most 0.005 either way.
    expect(Math.abs(actualLow - low)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(actualHigh - high)).toBeLessThanOrEqual(0.01);
  });
});

describe("wilsonInterval agreement with pathStats", () => {
  it("gives exactly the numbers pathStats reports for the unconstrained case", () => {
    const twinIds = findTwins(profile, goal).twinIds;
    for (const archetype of ["climb", "jump", "pivot"] as const) {
      const stats = pathStats(twinIds, archetype);
      expect(stats.reachedRate).toEqual(wilsonInterval(stats.reachedN, stats.n));
    }
  });
});

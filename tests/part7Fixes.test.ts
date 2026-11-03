/**
 * Regression tests for the review findings of Part 7 (three bugs and one doubt raised by Muse Code,
 * each confirmed by a probe). Kept together so the history is traceable.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../src/lib/engine";
import { Constraints } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { wilsonInterval } from "../src/lib/tools/stats";
import { survivorshipCaveat } from "../src/lib/engine";
import { input } from "./helpers/fixturesData";

describe("wilsonInterval rejects inputs that are not a proportion", () => {
  it.each([
    [12, 10],
    [5, 0],
    [-1, 10],
    [5, -10],
    [1.5, 10],
    [5, 10.5],
    [Number.NaN, 10],
  ])("throws for k=%s, n=%s instead of returning NaN or a negative interval", (k, n) => {
    expect(() => wilsonInterval(k, n)).toThrow(RangeError);
  });

  it("still accepts every valid k from 0 to n", () => {
    for (let k = 0; k <= 12; k++) {
      const [low, high] = wilsonInterval(k, 12);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
      expect(low).toBeLessThanOrEqual(high);
    }
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
  });
});

describe("the survivorship caveat counts only people who never reached the goal", () => {
  const sheet = (c: object) =>
    gatherEvidence(new EvidenceLedger(), { ...input, constraints: Constraints.parse(c) });

  it("is the same with or without limits, because people who reached the goal late did reach it", () => {
    const open = sheet({});
    const limited = sheet({ maxMonths: 24 });
    expect(limited.survivorship).toEqual(open.survivorship);
    expect(open.survivorship.notReachedShare).toBeCloseTo(0.25, 1); // 109.85 of 150 reached it
    expect(survivorshipCaveat(limited)).toBe(survivorshipCaveat(open));
  });

  it("does not count 'reached, but outside your limits' as stalled or gone even when almost nobody met the limit", () => {
    expect(sheet({ maxMonths: 12 }).survivorship.notReachedShare).toBeLessThan(0.4);
  });
});

describe("Constraints validates limits at the boundary", () => {
  it("accepts whole months from 1 to 240 and pay bands B1 to B5", () => {
    expect(Constraints.parse({ maxMonths: 24, minCompBand: "B3" })).toMatchObject({
      maxMonths: 24,
      minCompBand: "B3",
    });
    expect(Constraints.safeParse({ maxMonths: 1 }).success).toBe(true);
    expect(Constraints.safeParse({ maxMonths: 240 }).success).toBe(true);
  });

  it.each([
    { maxMonths: 0 },
    { maxMonths: 241 },
    { maxMonths: 1.5 },
    { maxMonths: "24" },
    { minCompBand: "B6" },
    { minCompBand: "b3" },
    { minCompBand: "platinum" },
  ])("rejects %j, so a bad limit cannot reach the tools", (bad) => {
    expect(Constraints.safeParse(bad).success).toBe(false);
  });
});

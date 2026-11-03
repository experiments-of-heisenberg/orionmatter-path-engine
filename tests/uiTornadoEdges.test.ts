/** Edge cases for the tornado layout: degenerate bars, summary rounding, and bars that stay on the track. */
import { describe, expect, it } from "vitest";
import type { Tornado, TornadoBar, TornadoOption } from "../src/lib/whatif";
import { tornadoRows, tornadoSummary, type TornadoRow } from "../src/ui/tornadoLayout";
import { exploreFor } from "./helpers/ui";

const metric = (rate: [number, number] | null) => ({
  route: rate ? ("climb" as const) : null,
  rate: rate ?? [0, 0],
  reachedN: rate ? 20 : 0,
  n: 30,
  twins: 100,
  thin: false,
});

const option = (label: string, rate: [number, number] | null, current = false): TornadoOption => ({
  label,
  current,
  metric: metric(rate),
});

const bar = (part: Partial<TornadoBar> & { options: TornadoOption[] }): TornadoBar => {
  const [first] = part.options;
  return {
    knob: "maxMonths",
    label: "Time limit",
    worst: first as TornadoOption,
    best: first as TornadoOption,
    swing: 0,
    ...part,
  };
};

const tornadoOf = (bars: TornadoBar[]): Tornado => ({ baseline: metric([0.5, 0.7]), bars });

describe("degenerate hand-built bars", () => {
  it("a single option per bar draws a point, with the current mark on it", () => {
    const only = option("24 months", [0.5, 0.7], true);
    const [row] = tornadoRows(tornadoOf([bar({ options: [only], worst: only, best: only })]));
    expect(row?.from).toBe(row?.to);
    expect(row?.current).toBe(row?.from);
  });

  it("equal worst and best give a zero-width bar", () => {
    const a = option("off", [0.5, 0.7], true);
    const b = option("on", [0.5, 0.7]);
    const [row] = tornadoRows(tornadoOf([bar({ options: [a, b], worst: a, best: b })]));
    expect(row?.from).toBe(0.6);
    expect(row?.to).toBe(0.6);
  });

  it("all options 'none within your limits' sit at zero and say so", () => {
    const a = option("off", null, true);
    const b = option("on", null);
    const [row] = tornadoRows(tornadoOf([bar({ options: [a, b], worst: a, best: b })]));
    expect(row?.from).toBe(0);
    expect(row?.to).toBe(0);
    expect(row?.worst.text).toBe("none within your limits");
    expect(row?.best.text).toBe("none within your limits");
  });

  it("a current value not among the options gives current null", () => {
    const a = option("off", [0.4, 0.6]);
    const b = option("on", [0.6, 0.8]);
    const [row] = tornadoRows(tornadoOf([bar({ options: [a, b], worst: a, best: b, swing: 20 })]));
    expect(row?.current).toBeNull();
  });
});

describe("tornadoSummary rounding", () => {
  const rowWith = (swing: number): TornadoRow => ({
    knob: "maxMonths",
    label: "Time limit",
    from: 0,
    to: 1,
    current: null,
    swing,
    worst: { label: "12 months", text: "none within your limits" },
    best: { label: "48 months", text: "74\u201392%, 47 of 55 engineers" },
    options: [],
  });

  it("a swing of 0.4 says no setting changes the odds", () => {
    expect(tornadoSummary([rowWith(0.4)])).toBe(
      "None of these settings changes the odds for the start-here route.",
    );
  });

  it("a swing of 0.6 says the same: anything under 1 point is 'none'", () => {
    expect(tornadoSummary([rowWith(0.6)])).toBe(
      "None of these settings changes the odds for the start-here route.",
    );
  });

  it("a swing of exactly 1.0 says 'point', not 'points' (review fix)", () => {
    expect(tornadoSummary([rowWith(1.0)])).toBe(
      "Time limit matters most: from 12 months (none within your limits) to 48 months " +
        "(74\u201392%, 47 of 55 engineers), a swing of about 1 point.",
    );
  });
});

describe("bars stay on the track", () => {
  it("every row's from/to are within [0, 1] across a sweep of constraint sets", () => {
    const flagSets: object[] = [
      {},
      { remote: true },
      { noRelocation: true },
      { remote: true, noRelocation: true },
    ];
    for (const maxMonths of [6, 12, 24, 48, 72]) {
      for (const minCompBand of ["B1", "B2", "B3", "B4", "B5"]) {
        for (const flags of flagSets) {
          const { data } = exploreFor({ maxMonths, minCompBand, ...flags });
          for (const row of tornadoRows(data.tornado)) {
            expect(row.from).toBeGreaterThanOrEqual(0);
            expect(row.to).toBeLessThanOrEqual(1);
            expect(row.from).toBeLessThanOrEqual(row.to);
            if (row.current !== null) {
              expect(row.current).toBeGreaterThanOrEqual(0);
              expect(row.current).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });
});

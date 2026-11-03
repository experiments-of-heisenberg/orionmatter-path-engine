/** The tornado chart's geometry and words, from real tornado data. */
import { describe, expect, it } from "vitest";
import type { Tornado, TornadoOption } from "../src/lib/whatif";
import { optionMid, optionText, tornadoRows, tornadoSummary } from "../src/ui/tornadoLayout";
import { exploreFor } from "./helpers/ui";

const tornado = exploreFor().data.tornado;
const option = (
  rate: [number, number] | null,
  extra: Partial<TornadoOption["metric"]> = {},
): TornadoOption => ({
  label: "x",
  current: false,
  metric: {
    route: rate ? "climb" : null,
    rate: rate ?? [0, 0],
    reachedN: 20,
    n: 30,
    twins: 100,
    thin: false,
    ...extra,
  },
});

describe("options", () => {
  it("the middle of the range, or zero when no route had anyone who met the limits", () => {
    expect(optionMid(option([0.5, 0.7]))).toBeCloseTo(0.6);
    expect(optionMid(option(null))).toBe(0);
  });
  it("says the range and the count, and 'none within your limits' instead of inventing 0%", () => {
    expect(optionText(option([0.5, 0.7]))).toBe("50\u201370%, 20 of 30 engineers");
    expect(optionText(option([0.5, 0.7], { thin: true }))).toMatch(/, limited evidence$/);
    expect(optionText(option(null))).toBe("none within your limits");
  });
});

describe("rows from the real tornado", () => {
  const rows = tornadoRows(tornado);
  it("keeps the widest swing first and every bar inside the track", () => {
    expect(rows.map((r) => r.knob)).toEqual(tornado.bars.map((b) => b.knob));
    expect(rows[0]?.knob).toBe("maxMonths");
    expect(rows[0]?.swing).toBeGreaterThan(rows[1]?.swing ?? 0);
    for (const r of rows) {
      expect(r.from).toBeGreaterThanOrEqual(0);
      expect(r.to).toBeLessThanOrEqual(1);
      expect(r.from).toBeLessThanOrEqual(r.to);
      if (r.current !== null) {
        expect(r.current).toBeGreaterThanOrEqual(r.from - 1e-9);
        expect(r.current).toBeLessThanOrEqual(r.to + 1e-9);
      }
    }
  });
  it("lists every value tried, marks the current one, and gives each a range and count", () => {
    const time = rows[0];
    expect(time?.options.length).toBeGreaterThanOrEqual(6);
    expect(time?.options.filter((o) => o.current)).toHaveLength(1);
    expect(time?.worst.text).toBe("none within your limits");
    expect(time?.best.text).toMatch(/^\d+\u2013\d+%, \d+ of \d+ engineers/);
  });
  it("the bar's width in points matches the swing the server reported (rounded to whole points)", () => {
    for (const r of rows) expect(Math.round((r.to - r.from) * 100)).toBe(r.swing);
  });
});

describe("summary", () => {
  it("names the limit that matters most with its worst and best values and the swing", () => {
    const text = tornadoSummary(tornadoRows(tornado));
    expect(text).toContain("Time limit matters most");
    expect(text).toContain("none within your limits");
    expect(text).toMatch(/a swing of about 83 points\.$/);
  });
  it("says so when nothing moves the odds, and when there are no rows", () => {
    const flat: Tornado = {
      baseline: tornado.baseline,
      bars: tornado.bars.map((b) => ({ ...b, swing: 0, worst: b.best })),
    };
    expect(tornadoSummary(tornadoRows(flat))).toBe(
      "None of these settings changes the odds for the start-here route.",
    );
    expect(tornadoSummary([])).toBe("No setting changes the odds.");
  });
});

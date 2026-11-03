/** Tests for the histogram binning and the radar geometry. */
import { describe, expect, it } from "vitest";
import { BIN_MONTHS, binPoints, MIN_SPAN, tallest, zoomDomain } from "../src/ui/histogram";
import { axisPoint, RADAR_AXES, radarPolygon, ringPolygon } from "../src/ui/radar";
import { exploreFor } from "./helpers/ui";

const pts = (...months: number[]) => months.map((m) => ({ months: m, within: true }));

describe("zoomDomain", () => {
  it("frames the data a little wider than its first and last point, in whole bins", () => {
    const d = zoomDomain(pts(30, 36, 44));
    expect(d).toEqual({ from: 24, to: 51 });
    expect(d.from % BIN_MONTHS).toBe(0);
    expect(d.to % BIN_MONTHS).toBe(0);
  });

  it("never starts before month 0 and is never narrower than the minimum span", () => {
    const early = zoomDomain(pts(2, 3));
    expect(early.from).toBe(0);
    expect(early.to - early.from).toBeGreaterThanOrEqual(MIN_SPAN);
    const tight = zoomDomain(pts(40, 41));
    expect(tight.to - tight.from).toBeGreaterThanOrEqual(MIN_SPAN);
    expect(tight.from).toBeLessThanOrEqual(40);
    expect(tight.to).toBeGreaterThanOrEqual(41);
  });

  it("widens to include the person's limit, on either side", () => {
    const d = zoomDomain(pts(30, 36), 60);
    expect(d.to).toBeGreaterThanOrEqual(60);
    const low = zoomDomain(pts(30, 36), 12);
    expect(low.from).toBeLessThanOrEqual(12);
  });

  it("gives a usable axis when there are no points", () => {
    expect(zoomDomain([])).toEqual({ from: 0, to: MIN_SPAN });
    expect(zoomDomain([], 36).to).toBeGreaterThanOrEqual(36);
  });

  it("holds for the real routes under real limits", () => {
    for (const c of [{}, { maxMonths: 24 }, { maxMonths: 12 }, { minCompBand: "B5" }]) {
      const { data } = exploreFor(c);
      for (const r of data.routes) {
        const d = zoomDomain(r.reachedPoints, (c as { maxMonths?: number }).maxMonths);
        expect(d.from).toBeGreaterThanOrEqual(0);
        expect(d.to - d.from).toBeGreaterThanOrEqual(MIN_SPAN);
        for (const p of r.reachedPoints) {
          expect(p.months).toBeGreaterThanOrEqual(d.from);
          expect(p.months).toBeLessThanOrEqual(d.to);
        }
      }
    }
  });
});

describe("binPoints", () => {
  it("counts every engineer exactly once, whatever the domain", () => {
    const { data } = exploreFor({ maxMonths: 30 });
    for (const r of data.routes) {
      for (const domain of [zoomDomain(r.reachedPoints, 30), { from: 0, to: 60 }, { from: 30, to: 42 }]) {
        const bins = binPoints(r.reachedPoints, domain);
        expect(bins.reduce((s, b) => s + b.within + b.outside, 0)).toBe(r.reachedPoints.length);
      }
    }
  });

  it("puts a point on a bin edge in the later bin, and clamps points beyond the ends", () => {
    // Bins are [3,6), [6,9), [9,12): 0 clamps into the first, 6 starts the second, 9 starts the third, 100 clamps into the third.
    const bins = binPoints(pts(6, 9, 100, 0), { from: 3, to: 12 });
    expect(bins.map((b) => [b.start, b.within])).toEqual([
      [3, 1],
      [6, 1],
      [9, 2],
    ]);
  });

  it("separates engineers who met the limits from those who did not", () => {
    const bins = binPoints(
      [
        { months: 10, within: true },
        { months: 11, within: false },
        { months: 12, within: false },
      ],
      { from: 9, to: 15 },
    );
    expect(bins[0]).toMatchObject({ start: 9, end: 12, within: 1, outside: 1 });
    expect(bins[1]).toMatchObject({ within: 0, outside: 1 });
  });

  it("handles a domain narrower than one bin and an empty list", () => {
    expect(binPoints([], { from: 0, to: 1 })).toHaveLength(1);
    expect(tallest(binPoints([], { from: 0, to: 30 }))).toBe(1);
    expect(tallest(binPoints(pts(5, 5, 5, 20), { from: 0, to: 30 }))).toBe(3);
  });
});

describe("radar geometry", () => {
  it("has six axes, the first pointing straight up", () => {
    expect(RADAR_AXES).toHaveLength(6);
    expect(axisPoint(0, 1, 100, 100, 50)).toEqual({ x: 100, y: 50 });
    expect(axisPoint(3, 1, 100, 100, 50)).toEqual({ x: 100, y: 150 });
  });

  it("puts a value of 100 on the rim and 0 at the centre, and clamps out-of-range values", () => {
    const full = { comp: 100, speed: 100, risk: 100, learning: 100, balance: 100, stability: 100 };
    const zero = { comp: 0, speed: 0, risk: 0, learning: 0, balance: 0, stability: 0 };
    expect(radarPolygon(full, 100, 100, 50)).toBe(ringPolygon(1, 100, 100, 50));
    expect(radarPolygon(zero, 100, 100, 50)).toBe(Array(6).fill("100,100").join(" "));
    expect(radarPolygon({ ...full, comp: 250, speed: -20 }, 100, 100, 50).split(" ")[0]).toBe("100,50");
    expect(radarPolygon({ ...full, speed: -20 }, 100, 100, 50).split(" ")[1]).toBe("100,100");
  });

  it("draws rings as closed hexagons with a point per axis", () => {
    for (const f of [0.25, 0.5, 1]) expect(ringPolygon(f, 160, 160, 100).split(" ")).toHaveLength(6);
  });

  it("every real route's polygon has six finite points inside the rim", () => {
    const { data } = exploreFor();
    for (const r of data.routes) {
      const points = radarPolygon(r.radar, 160, 160, 104)
        .split(" ")
        .map((p) => p.split(",").map(Number));
      expect(points).toHaveLength(6);
      for (const [x, y] of points) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(Math.hypot((x ?? 0) - 160, (y ?? 0) - 160)).toBeLessThanOrEqual(104.2);
      }
    }
  });
});

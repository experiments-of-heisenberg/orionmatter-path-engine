/** Step-marker edges: odd windows, every size and limit, and when the gap cannot hold. */
import { describe, expect, it } from "vitest";
import type { Archetype } from "../src/ui/format";
import { COMPACT, DESKTOP, MARKER_GAP, layoutMap, stepMarkers } from "../src/ui/mapLayout";
import { exploreFor } from "./helpers/ui";

const steps = (...windows: [number, number][]) => windows.map((monthWindow) => ({ monthWindow }));
const ARCHETYPES: Archetype[] = ["climb", "jump", "pivot"];

describe("odd windows", () => {
  const layout = layoutMap(exploreFor().data.routes, undefined, DESKTOP);

  it("a reversed window keeps the midpoint but its reach runs backwards", () => {
    const [m] = stepMarkers(layout, "climb", steps([30, 10]));
    expect(m?.months).toBe(20);
    expect(m?.window).toEqual([30, 10]);
    // fromX is x(30) and toX is x(10), so fromX > toX: the reach is inverted, stated, not fixed.
    expect(m?.fromX).toBeGreaterThan(m?.toX ?? 0);
    expect(Number.isFinite(m?.at.x ?? Number.NaN)).toBe(true);
  });

  it("states: NaN months give NaN months and reach, and the marker lands exactly on the person", () => {
    const [m] = stepMarkers(layout, "climb", steps([Number.NaN, Number.NaN]));
    expect(m?.months).toBeNaN();
    expect(m?.fromX).toBeNaN();
    expect(m?.toX).toBeNaN();
    // Bisection against a NaN target collapses to t = 0, the start of the line.
    expect(m?.at.x).toBe(layout.origin.x);
    expect(m?.at.y).toBe(layout.origin.y);
  });

  it("negative months clamp to 0 and stay on the line", () => {
    const [m] = stepMarkers(layout, "climb", steps([-20, -5]));
    expect(m?.months).toBe(0);
    expect(m?.fromX).toBe(layout.x(0));
    expect(m?.toX).toBe(layout.x(0));
    expect(m?.at.x).toBeGreaterThan(layout.origin.x);
  });

  it("windows beyond the axis clamp to the axis and the marker stops before the star", () => {
    const lane = layout.lanes.find((l) => l.archetype === "climb");
    const [m] = stepMarkers(layout, "climb", steps([500, 600]));
    expect(m?.months).toBe(layout.axisMax);
    expect(m?.at.x).toBeLessThanOrEqual(lane?.star.x ?? 0);
    expect(m?.fromX).toBe(layout.x(layout.axisMax));
  });

  it("100 steps do not throw and stay finite and inside the picture, but overlap badly (reported)", () => {
    const markers = stepMarkers(
      layout,
      "climb",
      Array.from({ length: 100 }, (_, i) => ({ monthWindow: [i, i + 1] as [number, number] })),
    );
    expect(markers).toHaveLength(100);
    for (const m of markers) {
      expect(Number.isFinite(m.at.x)).toBe(true);
      expect(Number.isFinite(m.at.y)).toBe(true);
      expect(m.at.x).toBeGreaterThanOrEqual(0);
      expect(m.at.x).toBeLessThanOrEqual(DESKTOP.width);
    }
    const unique = new Set(markers.map((m) => m.at.x)).size;
    // REPORT: 100 steps share only a few dozen x positions; the first markers pile exactly on
    // the floor (origin.x + MARKER_GAP) instead of spreading. Real plans have at most a handful
    // of steps, so this is stated, not fixed.
    expect(unique).toBeLessThan(100);
  });

  it("states: steps given out of order keep input order, with positions separated in that order", () => {
    const [first, second] = stepMarkers(layout, "climb", steps([20, 30], [0, 5]));
    expect(first?.index).toBe(0);
    expect(second?.index).toBe(1);
    expect(first?.months).toBe(25);
    expect(second?.months).toBe(2.5);
    // Separation pushes earlier indexes left, so the later-in-time step sits left of the earlier one.
    expect(first?.at.x).toBeLessThan(second?.at.x ?? 0);
  });
});

describe("every size and limit keeps markers on the line", () => {
  const sizes = [COMPACT, DESKTOP] as const;
  const limits = [undefined, 6, 12, 24, 48, 120] as const;

  it("x runs from the person to the lane's end, y from the person to the lane, indexes in order", () => {
    for (const size of sizes) {
      for (const maxMonths of limits) {
        const { data } = exploreFor(maxMonths === undefined ? {} : { maxMonths });
        const layout = layoutMap(data.routes, maxMonths, size);
        for (const archetype of ARCHETYPES) {
          const lane = layout.lanes.find((l) => l.archetype === archetype);
          if (!lane) continue;
          const markers = stepMarkers(layout, archetype, steps([0, 10], [10, 20], [20, 30]));
          expect(markers.map((m) => m.index)).toEqual(markers.map((_, i) => i));
          const loY = Math.min(layout.origin.y, lane.star.y) - 0.6;
          const hiY = Math.max(layout.origin.y, lane.star.y) + 0.6;
          for (const m of markers) {
            expect(m.at.x).toBeGreaterThanOrEqual(layout.origin.x);
            expect(m.at.x).toBeLessThanOrEqual(lane.star.x);
            expect(m.at.y).toBeGreaterThanOrEqual(loY);
            expect(m.at.y).toBeLessThanOrEqual(hiY);
          }
        }
      }
    }
  });
});

describe("MARKER_GAP", () => {
  const layout = layoutMap(exploreFor().data.routes, undefined, DESKTOP);

  it("holds between neighbours whenever the line is long enough", () => {
    const markers = stepMarkers(layout, "climb", steps([0, 5], [10, 15], [20, 25]));
    for (let i = 1; i < markers.length; i++) {
      expect((markers[i]?.at.x ?? 0) - (markers[i - 1]?.at.x ?? 0)).toBeGreaterThanOrEqual(MARKER_GAP - 0.5);
    }
    const same = stepMarkers(
      layout,
      "climb",
      Array.from({ length: 6 }, () => ({ monthWindow: [10, 10] as [number, number] })),
    );
    for (let i = 1; i < same.length; i++) {
      expect((same[i]?.at.x ?? 0) - (same[i - 1]?.at.x ?? 0)).toBeGreaterThanOrEqual(MARKER_GAP - 0.5);
    }
  });

  it("states: when the line is too short the first markers overlap at the floor rather than leave the line", () => {
    const many = stepMarkers(
      layout,
      "climb",
      Array.from({ length: 30 }, () => ({ monthWindow: [10, 10] as [number, number] })),
    );
    expect(new Set(many.map((m) => m.at.x)).size).toBeLessThan(30);
    expect(many[0]?.at.x).toBeCloseTo(layout.origin.x + MARKER_GAP, 0);
    for (const m of many) {
      expect(m.at.x).toBeGreaterThanOrEqual(layout.origin.x);
      const lane = layout.lanes.find((l) => l.archetype === "climb");
      expect(m.at.x).toBeLessThanOrEqual(lane?.star.x ?? 0);
    }
  });
});

/** Plan steps placed on a route's line: on the line, in order, apart, never off the map. */
import { describe, expect, it } from "vitest";
import { COMPACT, DESKTOP, MARKER_GAP, layoutMap, stepMarkers } from "../src/ui/mapLayout";
import { exploreFor } from "./helpers/ui";

const steps = (...windows: [number, number][]) => windows.map((monthWindow) => ({ monthWindow }));
const sample = exploreFor().data;
const layout = layoutMap(sample.routes, undefined, DESKTOP);

describe("stepMarkers", () => {
  it("places each step on its route's line, left to right in step order, at least MARKER_GAP apart", () => {
    const markers = stepMarkers(layout, "climb", steps([0, 8], [8, 18], [18, 28], [28, 40]));
    expect(markers.map((m) => m.index)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < markers.length; i++) {
      expect((markers[i]?.at.x ?? 0) - (markers[i - 1]?.at.x ?? 0)).toBeGreaterThanOrEqual(MARKER_GAP - 0.2);
    }
    const lane = layout.lanes.find((l) => l.archetype === "climb");
    for (const m of markers) {
      expect(m.at.x).toBeGreaterThan(layout.origin.x);
      expect(m.at.x).toBeLessThan(lane?.star.x ?? 0);
    }
  });

  it("a marker sits on the curve: its y is between the person's y and the lane's y", () => {
    for (const archetype of ["climb", "jump", "pivot"] as const) {
      const lane = layout.lanes.find((l) => l.archetype === archetype);
      const lo = Math.min(layout.origin.y, lane?.star.y ?? 0) - 0.5;
      const hi = Math.max(layout.origin.y, lane?.star.y ?? 0) + 0.5;
      for (const m of stepMarkers(layout, archetype, steps([0, 10], [10, 20]))) {
        expect(m.at.y).toBeGreaterThanOrEqual(lo);
        expect(m.at.y).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("an earlier month is further left: steps at month 5 and month 25 are ordered by month", () => {
    const [a, b] = stepMarkers(layout, "jump", steps([0, 10], [20, 30]));
    expect((a?.at.x ?? 0) < (b?.at.x ?? 0)).toBe(true);
    expect(a?.months).toBe(5);
    expect(b?.months).toBe(25);
  });

  it("steps past the end of the line stay on it (before the star) instead of leaving the route", () => {
    const lane = layout.lanes.find((l) => l.archetype === "jump");
    const markers = stepMarkers(layout, "jump", steps([0, 500], [500, 900]));
    for (const m of markers) expect(m.at.x).toBeLessThanOrEqual(lane?.star.x ?? 0);
  });

  it("steps at month 0 do not sit on top of the person", () => {
    const [m] = stepMarkers(layout, "climb", steps([0, 0]));
    expect(m?.at.x ?? 0).toBeGreaterThanOrEqual(layout.origin.x + MARKER_GAP - 0.2);
  });

  it("six steps in the same month keep apart rather than pile up", () => {
    const markers = stepMarkers(
      layout,
      "climb",
      steps(...Array.from({ length: 6 }, (): [number, number] => [10, 10])),
    );
    const xs = markers.map((m) => m.at.x);
    expect(new Set(xs).size).toBe(6);
  });

  it("gives routes nobody finished within the limits no markers, and so for a route with no data", () => {
    const limited = exploreFor({ maxMonths: 24 }).data;
    const l = layoutMap(limited.routes, 24, DESKTOP);
    expect(stepMarkers(l, "climb", steps([0, 10]))).toEqual([]);
    expect(stepMarkers(l, "jump", steps([0, 10]))).toHaveLength(1);
    const none = exploreFor(
      {},
      { ...exploreFor().person, goal: { targetLevel: "EM2", label: "Director" } },
    ).data;
    expect(stepMarkers(layoutMap(none.routes, undefined, DESKTOP), "climb", steps([0, 10]))).toEqual([]);
  });

  it("no steps, no markers; an unknown route, no markers", () => {
    expect(stepMarkers(layout, "climb", [])).toEqual([]);
    expect(stepMarkers(layout, "nope" as "climb", steps([0, 1]))).toEqual([]);
  });

  it("works on the phone layout too, with up to six steps all inside the picture", () => {
    const compact = layoutMap(sample.routes, undefined, COMPACT);
    const markers = stepMarkers(
      compact,
      "climb",
      steps([0, 5], [5, 10], [10, 18], [18, 26], [26, 34], [34, 40]),
    );
    expect(markers).toHaveLength(6);
    for (const m of markers) {
      expect(m.at.x).toBeGreaterThan(0);
      expect(m.at.x).toBeLessThan(COMPACT.width);
      expect(m.at.y).toBeGreaterThan(0);
      expect(m.at.y).toBeLessThan(COMPACT.height);
    }
  });

  it("keeps the window the plan gave, and where it reaches, for each marker", () => {
    const [m] = stepMarkers(layout, "climb", steps([6, 12]));
    expect(m?.window).toEqual([6, 12]);
    expect(m?.fromX).toBeCloseTo(layout.x(6));
    expect(m?.toX).toBeCloseTo(layout.x(12));
  });
});

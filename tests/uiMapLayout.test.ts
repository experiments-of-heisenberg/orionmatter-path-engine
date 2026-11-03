/** Tests for the constellation map's geometry: honest scales, sane positions, a deterministic sky. */
import { describe, expect, it } from "vitest";
import { COMPACT, DESKTOP, layoutMap } from "../src/ui/mapLayout";
import { exploreFor } from "./helpers/ui";

describe("layoutMap", () => {
  const base = exploreFor().data;
  const layout = layoutMap(base.routes, undefined, DESKTOP);

  it("has the three lanes in order, top to bottom, all ending right of the person", () => {
    expect(layout.lanes.map((l) => l.archetype)).toEqual(["climb", "jump", "pivot"]);
    const ys = layout.lanes.map((l) => l.star.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const lane of layout.lanes) expect(lane.star.x).toBeGreaterThan(layout.origin.x);
  });

  it("rounds the axis up to whole years, with a floor of 36 months, and ticks every 12", () => {
    expect(layout.axisMax).toBe(60); // pivot's window ends at 49
    expect(layout.ticks.map((t) => t.months)).toEqual([0, 12, 24, 36, 48, 60]);
    expect(layoutMap(base.routes.slice(1, 2), undefined).axisMax).toBe(36); // jump alone: 23 rounds to the floor
  });

  it("maps months to x linearly and clamps outside the axis", () => {
    const { x, size } = layout;
    expect(x(0)).toBe(size.padLeft);
    expect(x(60)).toBe(size.width - size.padRight);
    expect(x(30)).toBeCloseTo((x(0) + x(60)) / 2, 6);
    expect(x(-5)).toBe(x(0));
    expect(x(500)).toBe(x(60));
  });

  it("puts each star at its median, so a slower route sits further right", () => {
    const byMonths = layout.lanes
      .map((l) => [l.months, l.star.x] as const)
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    const xs = byMonths.map((p) => p[1]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(layout.lanes.find((l) => l.archetype === "jump")!.star.x).toBeLessThan(
      layout.lanes.find((l) => l.archetype === "climb")!.star.x,
    );
  });

  it("draws a typical-window band along each real route, between the P25 and P75 positions", () => {
    for (const lane of layout.lanes) {
      expect(lane.window).toBeDefined();
      const route = base.routes.find((r) => r.archetype === lane.archetype)!;
      const nums = [...lane.window!.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) =>
        Number(m[1]),
      );
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(layout.x(route.monthsToGoal![0]) - 0.5);
      expect(Math.max(...nums)).toBeLessThanOrEqual(layout.x(route.monthsToGoal![1]) + 0.5);
    }
  });

  it("sizes stars by how many engineers made it: a bigger crowd gives a bigger star, within 5 to 9", () => {
    const sizes = layout.lanes.map((l) => ({
      r: l.radius,
      n: base.routes.find((x) => x.archetype === l.archetype)!.reachedN,
    }));
    for (const { r } of sizes) {
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThanOrEqual(9);
    }
    const most = sizes.reduce((a, b) => (b.n > a.n ? b : a));
    expect(most.r).toBe(9);
    const fewest = sizes.reduce((a, b) => (b.n < a.n ? b : a));
    expect(fewest.r).toBeLessThan(most.r);
  });

  it("with a 24-month limit, marks the limit and turns routes nobody finished in time into ghosts at the fastest finish", () => {
    const { data } = exploreFor({ maxMonths: 24 });
    const limited = layoutMap(data.routes, 24, DESKTOP);
    expect(limited.limit).toEqual({ months: 24, x: limited.x(24) });
    const ghosts = limited.lanes.filter((l) => l.ghost).map((l) => l.archetype);
    expect(ghosts).toEqual(["climb", "pivot"]);
    for (const lane of limited.lanes.filter((l) => l.ghost)) {
      expect(lane.window).toBeUndefined();
      expect(lane.radius).toBe(5);
      const route = data.routes.find((r) => r.archetype === lane.archetype)!;
      expect(lane.months).toBe(route.ignoringLimits.fastestMonths);
      expect(lane.star.x).toBeGreaterThan(limited.limit!.x); // they finished after the limit
    }
  });

  it("extends the axis to include a limit that is longer than every route", () => {
    expect(layoutMap(base.routes, 120, DESKTOP).axisMax).toBe(120);
  });

  it("keeps every star, label anchor and tick inside the picture, on both layouts", () => {
    for (const size of [DESKTOP, COMPACT]) {
      const l = layoutMap(base.routes, 24, size);
      for (const lane of l.lanes) {
        expect(lane.star.x).toBeGreaterThan(0);
        expect(lane.star.x).toBeLessThan(size.width - size.padRight + 1);
        expect(lane.star.y).toBeGreaterThan(0);
        expect(lane.star.y).toBeLessThan(size.height - size.padBottom + 1);
        expect(lane.label.x).toBeLessThan(size.width);
      }
      for (const t of l.ticks) expect(t.x).toBeLessThanOrEqual(size.width - size.padRight + 0.001);
    }
  });

  it("is deterministic: the same input gives the same sky and the same paths", () => {
    const again = layoutMap(base.routes, undefined, DESKTOP);
    const { x: xA, ...dataA } = again; // the scale is a function; compare what it draws
    const { x: xB, ...dataB } = layout;
    expect(dataA).toEqual(dataB);
    expect([0, 17, 60].map(xA)).toEqual([0, 17, 60].map(xB));
    expect(layout.dust).toHaveLength(70);
    expect(layoutMap(base.routes, undefined, COMPACT).dust).toHaveLength(40);
    for (const d of layout.dust) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(DESKTOP.width);
      expect(d.o).toBeGreaterThan(0);
      expect(d.o).toBeLessThan(1);
    }
  });

  it("copes with no comparable engineers at all: three data-less lanes, no window, no crash", () => {
    const person = { ...exploreFor().person, goal: { targetLevel: "EM2", label: "Director" } };
    const { data } = exploreFor({}, person);
    const empty = layoutMap(data.routes, undefined, DESKTOP);
    expect(empty.axisMax).toBe(36);
    for (const lane of empty.lanes) {
      expect(lane.status).toBe("no_data");
      expect(lane.window).toBeUndefined();
      expect(Number.isFinite(lane.star.x)).toBe(true);
    }
  });

  it("never produces NaN in a path", () => {
    for (const c of [
      {},
      { maxMonths: 12 },
      { maxMonths: 36 },
      { minCompBand: "B5" },
      { remote: true, noRelocation: true },
    ]) {
      const { data } = exploreFor(c);
      for (const lane of layoutMap(data.routes, (c as { maxMonths?: number }).maxMonths, DESKTOP).lanes) {
        expect(lane.path).not.toMatch(/NaN|undefined|Infinity/);
        expect(lane.window ?? "").not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
});

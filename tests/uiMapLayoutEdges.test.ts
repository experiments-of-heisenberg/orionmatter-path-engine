/** Edge cases for the constellation map geometry: identical routes, long horizons, tiny limits. */
import { describe, expect, it } from "vitest";
import type { ClientRoute } from "../src/lib/api/serialize";
import { COMPACT, DESKTOP, layoutMap, type MapSize } from "../src/ui/mapLayout";
import { exploreFor } from "./helpers/ui";

const base: readonly ClientRoute[] = exploreFor().data.routes;
const climb: ClientRoute = base.find((r) => r.archetype === "climb")!;

/** The same figures on all three lanes, so only the lane index differs. */
const triple = (route: ClientRoute): ClientRoute[] => [
  route,
  { ...route, archetype: "jump" },
  { ...route, archetype: "pivot" },
];

const even = (route: ClientRoute): ClientRoute => ({
  ...route,
  n: 20,
  reachedN: 10,
  evidenceThin: false,
  monthsToGoal: [30, 40],
  monthsMedian: 35,
});

/** Every x/y pair in an SVG path string. */
const pairs = (path: string): [number, number][] => {
  const nums = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] ?? Number.NaN, nums[i + 1] ?? Number.NaN]);
  return out;
};

describe("hand-built routes", () => {
  it("identical values still give each lane its own y position", () => {
    const layout = layoutMap(triple(even(climb)), undefined, DESKTOP);
    expect(new Set(layout.lanes.map((l) => l.star.y)).size).toBe(3);
  });

  it("states it: reachedN all 0 gives ghosts of radius 5, and no-data lanes of radius 5 too", () => {
    const ghosts = layoutMap(triple({ ...climb, reachedN: 0 }), undefined, DESKTOP);
    for (const lane of ghosts.lanes) {
      expect(lane.status).toBe("none_within_limits");
      expect(lane.ghost).toBe(true);
      expect(lane.radius).toBe(5);
      expect(lane.window).toBeUndefined();
    }
    const empty = layoutMap(
      triple({
        ...climb,
        n: 5,
        reachedN: 0,
        monthsToGoal: null,
        monthsMedian: null,
        ignoringLimits: { reachedShare: 0, fastestMonths: null, highestBand: null },
      }),
      undefined,
      DESKTOP,
    );
    for (const lane of empty.lanes) {
      expect(lane.status).toBe("no_data");
      expect(lane.radius).toBe(5);
      expect(Number.isFinite(lane.star.x) && Number.isFinite(lane.star.y)).toBe(true);
    }
  });

  it("states it: a zero-width window [30,30] leaves the window undefined, so not even a dot renders", () => {
    const layout = layoutMap(triple({ ...even(climb), monthsToGoal: [30, 30], monthsMedian: 30 }), undefined);
    for (const lane of layout.lanes) expect(lane.window).toBeUndefined();
  });
});

describe("long horizons and limits", () => {
  it("a P75 of 200 months rounds the axis to a multiple of 12 with a sane tick count", () => {
    const layout = layoutMap(
      [{ ...even(climb), monthsToGoal: [100, 200], monthsMedian: 150 }, ...triple(even(climb)).slice(1)],
      undefined,
      DESKTOP,
    );
    expect(layout.axisMax).toBe(204);
    expect(layout.axisMax % 12).toBe(0);
    expect(layout.ticks.length).toBeLessThanOrEqual(20);
    for (const lane of layout.lanes) {
      expect(lane.star.x).toBeGreaterThanOrEqual(0);
      expect(lane.star.x).toBeLessThanOrEqual(DESKTOP.width);
    }
    for (const tick of layout.ticks) {
      expect(tick.x).toBeLessThanOrEqual(DESKTOP.width - DESKTOP.padRight + 0.001);
    }
  });

  it("a limit of 1 month sits near the left edge and a limit of 240 months stretches the axis", () => {
    const tiny = layoutMap(base, 1, DESKTOP);
    expect(tiny.limit?.months).toBe(1);
    expect(tiny.limit?.x).toBe(tiny.x(1));
    expect(tiny.axisMax % 12).toBe(0);
    const far = layoutMap(base, 240, DESKTOP);
    expect(far.axisMax).toBe(240);
    expect(far.limit?.x).toBe(DESKTOP.width - DESKTOP.padRight);
  });

  it("a limit exactly equal to a route's median lands exactly on that route's star", () => {
    const median = climb.monthsMedian!;
    const layout = layoutMap(base, median, DESKTOP);
    expect(layout.limit?.x).toBe(layout.lanes.find((l) => l.archetype === "climb")?.star.x);
  });
});

describe("compact labels and window curves", () => {
  it("in COMPACT, every label plus 60 px of text stays inside the picture, under every limit", () => {
    for (const limit of [undefined, 1, 12, 24, 36, 60, 120, 240] as const) {
      const layout = layoutMap(base, limit, COMPACT);
      for (const lane of layout.lanes) {
        // The compact drawing anchors its label at star.x + 10 (see Constellation Lane).
        expect(lane.star.x + 10 + 60, `${lane.archetype} under limit ${String(limit)}`).toBeLessThanOrEqual(
          COMPACT.width,
        );
      }
    }
  });

  it("window samples run left to right and never leave their lane's curve", () => {
    for (const size of [DESKTOP, COMPACT]) {
      for (const limit of [undefined, 12, 24] as const) {
        const layout = layoutMap(base, limit, size);
        for (const lane of layout.lanes) {
          if (!lane.window) continue;
          const points = pairs(lane.window);
          expect(points.length).toBeGreaterThanOrEqual(2);
          for (let i = 1; i < points.length; i++) {
            expect(points[i]?.[0] ?? Number.NaN).toBeGreaterThanOrEqual(points[i - 1]?.[0] ?? Number.NaN);
          }
          const lo = Math.min(layout.origin.y, lane.star.y) - 0.6;
          const hi = Math.max(layout.origin.y, lane.star.y) + 0.6;
          for (const [, y] of points) {
            expect(y).toBeGreaterThanOrEqual(lo);
            expect(y).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
  });
});

describe("path bounds", () => {
  it("no number in any path string leaves a padded picture, in any real scenario", () => {
    const scenarios: { constraints: object; limit: number | undefined }[] = [
      { constraints: {}, limit: undefined },
      { constraints: { maxMonths: 24 }, limit: 24 },
      { constraints: { maxMonths: 12 }, limit: 12 },
      { constraints: { maxMonths: 1 }, limit: 1 },
      { constraints: { maxMonths: 240 }, limit: 240 },
      { constraints: { minCompBand: "B5" }, limit: undefined },
    ];
    const sizes: MapSize[] = [DESKTOP, COMPACT];
    for (const { constraints, limit } of scenarios) {
      const { data } = exploreFor(constraints);
      for (const size of sizes) {
        const layout = layoutMap(data.routes, limit, size);
        for (const lane of layout.lanes) {
          for (const path of [lane.path, lane.window ?? ""]) {
            for (const [x, y] of pairs(path)) {
              expect(x, `${lane.archetype} x in ${path.slice(0, 40)}`).toBeGreaterThanOrEqual(-50);
              expect(x, `${lane.archetype} x in ${path.slice(0, 40)}`).toBeLessThanOrEqual(size.width + 50);
              expect(y, `${lane.archetype} y in ${path.slice(0, 40)}`).toBeGreaterThanOrEqual(-50);
              expect(y, `${lane.archetype} y in ${path.slice(0, 40)}`).toBeLessThanOrEqual(size.height + 50);
            }
          }
        }
      }
    }
  });
});

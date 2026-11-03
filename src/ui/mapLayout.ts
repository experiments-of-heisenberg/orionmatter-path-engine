/**
 * mapLayout.ts: the geometry of the constellation map, as pure functions.
 *
 * The map is a time chart dressed as a star chart. Horizontal distance is MONTHS from today. The
 * person is a node on the left; each route is a thin line that fans out to its own lane and ends in
 * a star at the typical (median) arrival time. A soft band along the line is the typical window
 * (P25 to P75). Star size says how many comparable engineers made it. A route nobody finished within
 * the person's limits becomes a faint dotted line ending in a hollow marker where the fastest
 * engineer finished outside the limit. All of that is computed here, not in the drawing code, so it
 * can be tested without a browser.
 */
import type { ClientRoute } from "../lib/api/serialize";
import { routeStatus, type Archetype, type RouteStatus } from "./format";

export interface MapSize {
  width: number;
  height: number;
  /** Space on the left for the "You" node and on the right for the labels. */
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

/** Wide layout for desktop and a tall one for phones. */
export const DESKTOP: MapSize = {
  width: 1000,
  height: 420,
  padLeft: 120,
  padRight: 150,
  padTop: 60,
  padBottom: 92,
};
export const COMPACT: MapSize = {
  width: 420,
  height: 520,
  padLeft: 64,
  padRight: 78,
  padTop: 64,
  padBottom: 78,
};

export interface Point {
  x: number;
  y: number;
}

export interface LaneLayout {
  archetype: Archetype;
  status: RouteStatus;
  /** Cubic Bézier from the person to the end of the line. */
  path: string;
  /** The same curve, restricted to the typical window; undefined when there is no window. */
  window?: string;
  /** Where the star (or the ghost marker) sits. */
  star: Point;
  /** Radius of the star. */
  radius: number;
  /** Where the label goes. */
  label: Point;
  /** True when the end of the line is a "reached it later" ghost, not a real arrival. */
  ghost: boolean;
  /** Months the star stands for. */
  months: number | null;
}

export interface MapLayout {
  size: MapSize;
  /** Where the person is. */
  origin: Point;
  /** Months mapped to x, and the rounded maximum of the axis. */
  axisMax: number;
  x: (months: number) => number;
  ticks: { months: number; x: number }[];
  lanes: LaneLayout[];
  /** The person's time limit as a vertical line, when one is set. */
  limit?: { months: number; x: number };
  /** Background stars, deterministic so server and browser draw the same sky. */
  dust: { x: number; y: number; r: number; o: number }[];
}

/** Largest month a route needs the axis to reach. */
function reach(route: ClientRoute): number {
  const status = routeStatus(route);
  if (status === "none_within_limits") return route.ignoringLimits.fastestMonths ?? 0;
  return route.monthsToGoal?.[1] ?? 0;
}

/** Round a number up to the next multiple of `step`, with a floor. */
const roundUp = (value: number, step: number, floor: number): number =>
  Math.max(floor, Math.ceil(value / step) * step);

/** A small deterministic random generator (mulberry32), so the sky never changes between renders. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Evaluate a cubic Bézier at t. */
function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Compute the layout for a set of routes.
 *
 * @param routes the three routes, in order climb, jump, pivot
 * @param maxMonths the person's time limit, if any
 * @param size which layout to use
 */
export function layoutMap(
  routes: readonly ClientRoute[],
  maxMonths: number | undefined,
  size: MapSize = DESKTOP,
): MapLayout {
  const innerWidth = size.width - size.padLeft - size.padRight;
  const axisMax = roundUp(Math.max(0, ...routes.map(reach), maxMonths ?? 0), 12, 36);
  const x = (months: number): number =>
    size.padLeft + (Math.min(Math.max(months, 0), axisMax) / axisMax) * innerWidth;
  const originY = size.height / 2;
  const origin: Point = { x: size.padLeft - (size.width > 600 ? 56 : 30), y: originY };
  const laneSpacing = (size.height - size.padTop - size.padBottom) / 2;
  const maxMade = Math.max(1, ...routes.map((r) => r.reachedN));

  const lanes = routes.map((route, index): LaneLayout => {
    const status = routeStatus(route);
    const laneY = size.padTop + index * laneSpacing;
    const ghost = status === "none_within_limits";
    const months = ghost
      ? route.ignoringLimits.fastestMonths
      : (route.monthsMedian ?? route.monthsToGoal?.[0] ?? null);
    const endX = x(months ?? 0);
    const end: Point = { x: endX, y: laneY };
    const p0 = origin;
    const dx = Math.max(40, endX - p0.x);
    const p1: Point = { x: p0.x + dx * 0.42, y: p0.y };
    const p2: Point = { x: p0.x + dx * 0.58, y: laneY };
    const path = `M ${round1(p0.x)} ${round1(p0.y)} C ${round1(p1.x)} ${round1(p1.y)}, ${round1(p2.x)} ${round1(p2.y)}, ${round1(end.x)} ${round1(end.y)}`;

    let window: string | undefined;
    if (!ghost && route.monthsToGoal && months !== null) {
      const lo = x(route.monthsToGoal[0]);
      const hi = x(route.monthsToGoal[1]);
      const samples: string[] = [];
      for (let i = 0; i <= 80; i++) {
        const point = bezier(p0, p1, p2, end, i / 80);
        if (point.x >= lo && point.x <= hi) samples.push(`${round1(point.x)} ${round1(point.y)}`);
      }
      // Always end the window exactly on the line at the top of the range, even for a very short window.
      if (samples.length >= 2) window = `M ${samples.join(" L ")}`;
    }

    return {
      archetype: route.archetype,
      status,
      path,
      ...(window ? { window } : {}),
      star: end,
      radius: ghost || status === "no_data" ? 5 : round1(5 + 4 * Math.sqrt(route.reachedN / maxMade)),
      label: { x: end.x + 16, y: laneY },
      ghost,
      months,
    };
  });

  const ticks: { months: number; x: number }[] = [];
  for (let m = 0; m <= axisMax; m += 12) ticks.push({ months: m, x: x(m) });

  const random = rng(1026);
  const dust = Array.from({ length: size.width > 600 ? 70 : 40 }, () => ({
    x: round1(random() * size.width),
    y: round1(random() * size.height),
    r: round1(0.5 + random() * 0.9),
    o: round1(0.18 + random() * 0.4),
  }));

  return {
    size,
    origin,
    axisMax,
    x,
    ticks,
    lanes,
    ...(maxMonths !== undefined ? { limit: { months: maxMonths, x: x(maxMonths) } } : {}),
    dust,
  };
}

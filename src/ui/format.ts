/**
 * format.ts: how the interface says numbers and statuses.
 *
 * Every figure the person sees is a range with the number of engineers behind it, in plain words.
 * Keeping the wording in one pure module means the cards, the map labels, the captions and the
 * screen-reader text can never disagree, and it is easy to test.
 */
import type { ClientRoute } from "../lib/api/serialize";

export type Archetype = ClientRoute["archetype"];

/** Display name of each route. */
export const ARCHETYPE_LABEL: Readonly<Record<Archetype, string>> = {
  climb: "Climb",
  jump: "Jump",
  pivot: "Pivot",
};

/** One plain sentence on what each route means. */
export const ARCHETYPE_BLURB: Readonly<Record<Archetype, string>> = {
  climb: "Grow into it step by step where you are",
  jump: "Change company to move up faster",
  pivot: "Switch focus first, then move up",
};

/** The en dash used between the ends of a range. */
const DASH = "\u2013";

/** "34–40 months", or a plain statement when nobody reached it. */
export function monthsRange(range: readonly [number, number] | null): string {
  return range === null ? "No one reached it" : `${range[0]}${DASH}${range[1]} months`;
}

/** A fraction range as a percentage range: [0.74, 0.92] gives "74–92%". */
export function percentRange(range: readonly [number, number]): string {
  return `${Math.round(range[0] * 100)}${DASH}${Math.round(range[1] * 100)}%`;
}

/** "55 comparable engineers" (singular for one). */
export function engineersText(n: number): string {
  return `${n} comparable engineer${n === 1 ? "" : "s"}`;
}

/** "B4–B5", or "B5" when both ends match, or an em dash when there is no data. */
export function bandRange(range: readonly [string, string]): string {
  if (range[0] === "-" || range[1] === "-") return "\u2014";
  return range[0] === range[1] ? range[0] : `${range[0]}${DASH}${range[1]}`;
}

/** How a route stands, from the viewpoint of the person's limits and the amount of evidence. */
export type RouteStatus = "ok" | "limited" | "none_within_limits" | "no_data";

export function routeStatus(route: ClientRoute): RouteStatus {
  if (route.n === 0) return "no_data";
  if (route.reachedN === 0) return route.ignoringLimits.reachedShare > 0 ? "none_within_limits" : "no_data";
  return route.evidenceThin ? "limited" : "ok";
}

/** A short badge for a status, or undefined when no badge is needed. */
export function statusBadge(status: RouteStatus): string | undefined {
  switch (status) {
    case "limited":
      return "Limited evidence";
    case "none_within_limits":
      return "None within your limits";
    case "no_data":
      return "No comparable engineers";
    case "ok":
      return undefined;
  }
}

/**
 * One plain sentence about a route, used under the map, on cards and for screen readers:
 * "Usually 34–40 months. 74–92% got there. Based on 55 engineers."
 */
export function summaryLine(route: ClientRoute): string {
  const status = routeStatus(route);
  if (status === "no_data") return "No comparable engineers matched, so there is no evidence for this route.";
  if (status === "none_within_limits") {
    const fastest = route.ignoringLimits.fastestMonths;
    return (
      `No comparable engineer reached it within your limits (${engineersText(route.n)}).` +
      (fastest !== null ? ` The fastest took ${fastest} months.` : "")
    );
  }
  const limited = status === "limited" ? " Limited evidence." : "";
  return `Usually ${monthsRange(route.monthsToGoal)}. ${percentRange(route.reachedRate)} got there. Based on ${route.n} engineers.${limited}`;
}

/** The text a screen reader gets for a route on the map. */
export function routeAriaLabel(route: ClientRoute): string {
  return `${ARCHETYPE_LABEL[route.archetype]} route. ${summaryLine(route)}`;
}

/** Share by outcome as whole percentages that always add to 100 (largest remainder). */
export function roundedShares(shares: readonly number[]): number[] {
  const total = shares.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return shares.map(() => 0);
  const exact = shares.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return floors;
}

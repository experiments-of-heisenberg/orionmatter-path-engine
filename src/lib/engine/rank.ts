/**
 * rank.ts: which route to look at first, given the person's risk tolerance.
 *
 * Risk tolerance has to DO something, or the slider is decoration. The honest lever the data
 * offers is the width of each route's success interval: a route with little evidence has a wide
 * interval, so its optimistic end is high and its cautious end is low.
 *   low    -> rank by the cautious (low) end: steady, well-evidenced routes first
 *   medium -> rank by the middle of the interval
 *   high   -> rank by the optimistic (high) end: upside first, even on thinner evidence
 * Ties go to the faster route, then to the fixed order climb, jump, pivot. Pure and deterministic.
 */
import type { Archetype, Constraints } from "../schemas";
import type { RouteFacts } from "./facts";

/** The order routes are suggested in, and the one to look at first. */
export interface Ranking {
  /** All three archetypes, best first. Routes with no evidence of success come last. */
  order: Archetype[];
  /** The first route in `order`, or null when no route has any evidence of success. */
  recommended: Archetype | null;
  /** One plain sentence saying how the order was decided, shown next to it in the interface. */
  basis: string;
}

const BASIS: Record<Constraints["riskTolerance"], string> = {
  low: "Ordered by the low end of each route's success range, so well-evidenced, steadier routes come first (your risk tolerance is low).",
  medium: "Ordered by the middle of each route's success range (your risk tolerance is medium).",
  high: "Ordered by the high end of each route's success range, so upside comes first even when the evidence is thinner (your risk tolerance is high).",
};

/** The point of a route's success interval that this risk tolerance cares about. */
function key(route: RouteFacts, risk: Constraints["riskTolerance"]): number {
  const [low, high] = route.reachedRate;
  return risk === "low" ? low : risk === "high" ? high : (low + high) / 2;
}

/** Midpoint of the timeline, or Infinity when there is none (so no timeline loses a tie). */
const monthsMid = (route: RouteFacts): number =>
  route.monthsToGoal === null ? Infinity : (route.monthsToGoal[0] + route.monthsToGoal[1]) / 2;

/**
 * Rank the routes.
 *
 * @param routes facts for climb, jump and pivot (in that order)
 * @param risk the person's risk tolerance
 */
export function rankRoutes(routes: readonly RouteFacts[], risk: Constraints["riskTolerance"]): Ranking {
  // A route is only worth recommending if someone actually reached the goal on it (within the limits).
  const eligible = (route: RouteFacts): boolean => route.stats.reachedN > 0;
  const sorted = routes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => {
      const ea = eligible(a.route);
      const eb = eligible(b.route);
      if (ea !== eb) return ea ? -1 : 1;
      if (ea) {
        const byKey = key(b.route, risk) - key(a.route, risk);
        if (byKey !== 0) return byKey;
        const monthsA = monthsMid(a.route);
        const monthsB = monthsMid(b.route);
        // Compare explicitly: Infinity - Infinity is NaN and Infinity - 20 is Infinity, neither a usable order.
        if (monthsA !== monthsB)
          return monthsA === Infinity ? 1 : monthsB === Infinity ? -1 : monthsA - monthsB;
      }
      return a.index - b.index;
    });
  const order = sorted.map((item) => item.route.archetype);
  const first = sorted[0];
  return {
    order,
    recommended: first && eligible(first.route) ? first.route.archetype : null,
    basis: BASIS[risk],
  };
}

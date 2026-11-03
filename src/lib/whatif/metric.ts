/**
 * metric.ts: the one number-with-honesty a What-if comparison is measured by.
 *
 * The tornado and "what would it take" both need to ask "how good is the best route for this
 * person right now?" so they ask it the same way: the route the plan would suggest first (the
 * recommended one), its success range, and how many comparable engineers stand behind it.
 * It is always a range with a sample size. When no route has anyone who met the person's limits
 * there is no recommended route and the metric says so instead of inventing a zero.
 */
import type { FactSheet } from "../engine";
import type { Archetype } from "../schemas";

/** How good the best route is for one set of constraints. */
export interface HeadlineMetric {
  /** The route the plan suggests first, or null when no route has anyone who met the limits. */
  route: Archetype | null;
  /** 95% range for the share who reached the goal on that route; [0, 0] when `route` is null. */
  rate: [number, number];
  /** Comparable engineers on that route who reached the goal within the limits. */
  reachedN: number;
  /** Comparable engineers on that route. */
  n: number;
  /** Comparable engineers across all routes. */
  twins: number;
  /** True when the route's evidence is limited. */
  thin: boolean;
}

/** The headline metric of a fact sheet. */
export function headlineMetric(sheet: FactSheet): HeadlineMetric {
  const best = sheet.routes.find((route) => route.archetype === sheet.ranking.recommended);
  if (!best) return { route: null, rate: [0, 0], reachedN: 0, n: 0, twins: sheet.twins.n, thin: true };
  return {
    route: best.archetype,
    rate: best.reachedRate,
    reachedN: best.stats.reachedN,
    n: best.n,
    twins: sheet.twins.n,
    thin: best.evidenceThin,
  };
}

/** Middle of the success range, as a fraction (0 when there is no route). */
export const rateMid = (metric: HeadlineMetric): number => (metric.rate[0] + metric.rate[1]) / 2;

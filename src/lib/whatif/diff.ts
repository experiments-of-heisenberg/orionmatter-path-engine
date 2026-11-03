/**
 * diff.ts: what changed between two fact sheets, as plain facts.
 *
 * When the person changes a constraint, the interface needs to say WHAT moved ("the climb
 * route disappeared", "the jump route got 5 months faster"), and the narrator needs
 * something it cannot get wrong. This module produces both from the engine's numbers:
 *
 *   FactSheet (before) + FactSheet (after)  ->  SheetDiff { per-route deltas, facts[] }
 *
 * Each `Fact` is one sentence WRITTEN BY CODE, with the numbers it uses listed and the ids of
 * the evidence it rests on. The model never sees raw numbers to restate: it picks and orders
 * facts, and `verifyNarration` rejects any number that is not in a fact it cited.
 *
 * Honesty rules built in:
 *   - a change in a success range is called "real" only when the old and new intervals do not
 *     overlap; otherwise the fact says it may be noise
 *   - skill facts say "associated with", never "causes"
 *   - facts carry a `thin` flag when the evidence is limited, and say so in their text
 */
import type { FactSheet, RouteFacts } from "../engine";
import type { Archetype } from "../schemas";

/** What kind of change a fact describes. */
export type FactKind =
  | "twin_pool"
  | "recommended"
  | "route_appeared"
  | "route_disappeared"
  | "outside_limits"
  | "success_rate"
  | "timeline"
  | "comp"
  | "risk"
  | "skill";

/** One checkable statement about the change, written by code. */
export interface Fact {
  /** Stable within one diff: f1, f2, ... Narration cites these. */
  id: string;
  kind: FactKind;
  /** The route it is about, or null for a statement about the whole plan. */
  archetype: Archetype | null;
  /** A plain sentence. Every number in it is listed in `numbers`. */
  text: string;
  /** Every number the text uses (percentages as whole numbers, months, counts). */
  numbers: number[];
  /** Ledger evidence ids the statement rests on (before and after). */
  evidenceIds: string[];
  /** True when the evidence behind it is limited, and the text says so. */
  thin: boolean;
  /** True when the narration must cover this fact: it is a headline change someone could otherwise hide. */
  mustMention: boolean;
}

/** How one route's headline numbers moved. Numbers are kept raw for the interface to draw. */
export interface RouteDiff {
  archetype: Archetype;
  status: "unchanged" | "shifted" | "appeared" | "disappeared";
  n: { before: number; after: number };
  /** Twins who reached the goal within the person's limits. */
  reachedN: { before: number; after: number };
  reachedRate: { before: [number, number]; after: [number, number]; separated: boolean };
  /** Change in the middle of the success range, in percentage points (after minus before). */
  rateShift: number;
  months: { before: [number, number] | null; after: [number, number] | null };
  /** Change in the middle of the timeline, in months (negative is faster); null when either side has none. */
  monthsShift: number | null;
  compBand: { before: [string, string]; after: [string, string] };
  radar: Record<keyof RouteFacts["radar"], { before: number; after: number }>;
}

/** The whole difference between two plans. */
export interface SheetDiff {
  routes: RouteDiff[];
  twins: { before: number; after: number };
  recommended: { before: Archetype | null; after: Archetype | null; changed: boolean };
  facts: Fact[];
  /** True when nothing worth saying changed. */
  unchanged: boolean;
}

/** Smallest change in the middle of a success range worth a fact, in percentage points. */
export const RATE_SHIFT_MIN = 5;
/** Smallest change in the middle of a timeline worth a fact, in months. */
export const MONTHS_SHIFT_MIN = 3;
/** Share of twins who reached the goal only outside the limits that is worth saying out loud. */
export const OUTSIDE_LIMITS_MIN = 0.1;

const pct = (value: number): number => Math.round(value * 100);
const mid = (range: readonly [number, number]): number => (range[0] + range[1]) / 2;
const sameRange = <T>(a: readonly [T, T], b: readonly [T, T]): boolean => a[0] === b[0] && a[1] === b[1];
const rangeText = (range: readonly [number, number]): string => `${pct(range[0])}-${pct(range[1])}%`;
const monthsText = (range: readonly [number, number]): string => `${range[0]}-${range[1]} months`;
const intervalsOverlap = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  a[0] <= b[1] && b[0] <= a[1];
const NAME: Record<Archetype, string> = { climb: "climb", jump: "jump", pivot: "pivot" };
/** Display name of a route, for sentences. */
const route = (archetype: Archetype): string => `the ${NAME[archetype]} route`;
/** Upper-case the first letter, for a sentence that starts with a route name. */
const cap = (text: string): string => text.replace(/^./, (c) => c.toUpperCase());
/** A band range for people: "B5" when both ends match, otherwise "B4-B5". */
const bandText = (range: readonly [string, string]): string =>
  range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`;

/** Diff one route. */
function diffRoute(before: RouteFacts, after: RouteFacts): RouteDiff {
  const separated = !intervalsOverlap(before.reachedRate, after.reachedRate);
  const hadAnyone = before.stats.reachedN > 0;
  const hasAnyone = after.stats.reachedN > 0;
  const monthsShift =
    before.monthsToGoal && after.monthsToGoal ? mid(after.monthsToGoal) - mid(before.monthsToGoal) : null;
  const rateShift = Math.round((mid(after.reachedRate) - mid(before.reachedRate)) * 100);
  const moved =
    Math.abs(rateShift) >= RATE_SHIFT_MIN ||
    (monthsShift !== null && Math.abs(monthsShift) >= MONTHS_SHIFT_MIN) ||
    !sameRange(before.compBandRange, after.compBandRange) ||
    before.n !== after.n;
  const radarKeys = Object.keys(before.radar) as (keyof RouteFacts["radar"])[];
  return {
    archetype: after.archetype,
    status:
      hadAnyone && !hasAnyone
        ? "disappeared"
        : !hadAnyone && hasAnyone
          ? "appeared"
          : moved
            ? "shifted"
            : "unchanged",
    n: { before: before.n, after: after.n },
    reachedN: { before: before.stats.reachedN, after: after.stats.reachedN },
    reachedRate: { before: before.reachedRate, after: after.reachedRate, separated },
    rateShift,
    months: { before: before.monthsToGoal, after: after.monthsToGoal },
    monthsShift,
    compBand: { before: before.compBandRange, after: after.compBandRange },
    radar: Object.fromEntries(
      radarKeys.map((key) => [key, { before: before.radar[key], after: after.radar[key] }]),
    ) as RouteDiff["radar"],
  };
}

/** Evidence ids a route's numbers rest on, before and after (deduplicated). */
const idsOf = (before: RouteFacts, after: RouteFacts): string[] => [
  ...new Set([before.statsEvidenceId, after.statsEvidenceId]),
];

/** Whether to put "(limited evidence)" on a route's facts. */
const thinText = (thin: boolean): string => (thin ? " (limited evidence)" : "");

/**
 * Compare two fact sheets and describe the difference.
 *
 * @param before the plan for the constraints the person had
 * @param after  the plan for the constraints after the What-if change
 */
export function diffSheets(before: FactSheet, after: FactSheet): SheetDiff {
  const facts: Fact[] = [];
  const add = (fact: Omit<Fact, "id">): void => {
    facts.push({ id: `f${facts.length + 1}`, ...fact });
  };

  // ---- whole-plan facts ----
  if (before.twins.n !== after.twins.n) {
    add({
      kind: "twin_pool",
      archetype: null,
      text: `The number of comparable engineers changed from ${before.twins.n} to ${after.twins.n}${thinText(after.twins.n < 15)}.`,
      numbers: [before.twins.n, after.twins.n],
      evidenceIds: [...new Set([before.twins.evidenceId, after.twins.evidenceId])],
      thin: after.twins.n < 15,
      mustMention: false,
    });
  }
  const recommended = {
    before: before.ranking.recommended,
    after: after.ranking.recommended,
    changed: before.ranking.recommended !== after.ranking.recommended,
  };
  if (recommended.changed) {
    const text =
      recommended.after === null
        ? "No route has any comparable engineer who met your limits, so none can be recommended."
        : recommended.before === null
          ? `${route(recommended.after)} is now the first route to look at.`
          : `The first route to look at changed from ${route(recommended.before)} to ${route(recommended.after)}.`;
    add({
      kind: "recommended",
      archetype: recommended.after,
      text: text.replace(/^./, (c) => c.toUpperCase()),
      numbers: [],
      evidenceIds: [],
      thin: false,
      mustMention: true,
    });
  }

  // ---- per-route facts ----
  const routes: RouteDiff[] = [];
  for (const afterRoute of after.routes) {
    const beforeRoute = before.routes.find((r) => r.archetype === afterRoute.archetype);
    if (!beforeRoute) continue;
    const diff = diffRoute(beforeRoute, afterRoute);
    routes.push(diff);
    const a = afterRoute.archetype;
    const ids = idsOf(beforeRoute, afterRoute);
    const thin = afterRoute.evidenceThin;

    if (diff.status === "disappeared") {
      add({
        kind: "route_disappeared",
        archetype: a,
        text:
          `No comparable engineer reached the goal on ${route(a)} within your limits ` +
          `(${beforeRoute.stats.reachedN} of ${beforeRoute.n} did before).` +
          (afterRoute.stats.ignoringLimits.fastestMonths !== null
            ? ` The fastest there took ${afterRoute.stats.ignoringLimits.fastestMonths} months.`
            : ""),
        numbers: [
          beforeRoute.stats.reachedN,
          beforeRoute.n,
          ...(afterRoute.stats.ignoringLimits.fastestMonths !== null
            ? [afterRoute.stats.ignoringLimits.fastestMonths]
            : []),
        ],
        evidenceIds: ids,
        thin: false,
        mustMention: true,
      });
      continue;
    }
    if (diff.status === "appeared") {
      add({
        kind: "route_appeared",
        archetype: a,
        text:
          `${cap(route(a))} now has evidence: ${afterRoute.stats.reachedN} of ${afterRoute.n} comparable engineers reached the goal` +
          `${afterRoute.monthsToGoal ? `, typically in ${monthsText(afterRoute.monthsToGoal)}` : ""}${thinText(thin)}.`,
        numbers: [afterRoute.stats.reachedN, afterRoute.n, ...(afterRoute.monthsToGoal ?? [])],
        evidenceIds: ids,
        thin,
        mustMention: true,
      });
      continue;
    }

    if (Math.abs(diff.rateShift) >= RATE_SHIFT_MIN) {
      const verdict = diff.reachedRate.separated
        ? "the ranges no longer overlap, so this is a real change in the evidence"
        : "the ranges still overlap, so this may be noise";
      add({
        kind: "success_rate",
        archetype: a,
        text:
          `On ${route(a)}, the share who reached the goal moved from ${rangeText(beforeRoute.reachedRate)} to ` +
          `${rangeText(afterRoute.reachedRate)} (n=${afterRoute.n}); ${verdict}${thinText(thin)}.`,
        numbers: [...beforeRoute.reachedRate.map(pct), ...afterRoute.reachedRate.map(pct), afterRoute.n],
        evidenceIds: ids,
        thin,
        mustMention: diff.reachedRate.separated,
      });
    }
    if (
      diff.monthsShift !== null &&
      Math.abs(diff.monthsShift) >= MONTHS_SHIFT_MIN &&
      beforeRoute.monthsToGoal &&
      afterRoute.monthsToGoal
    ) {
      add({
        kind: "timeline",
        archetype: a,
        text:
          `On ${route(a)}, the typical time to the goal changed from ${monthsText(beforeRoute.monthsToGoal)} to ` +
          `${monthsText(afterRoute.monthsToGoal)}${thinText(thin)}.`,
        numbers: [...beforeRoute.monthsToGoal, ...afterRoute.monthsToGoal],
        evidenceIds: ids,
        thin,
        mustMention: false,
      });
    }
    if (!sameRange(beforeRoute.compBandRange, afterRoute.compBandRange) && afterRoute.monthsToGoal) {
      add({
        kind: "comp",
        archetype: a,
        text: `On ${route(a)}, the pay band reached changed from ${bandText(beforeRoute.compBandRange)} to ${bandText(afterRoute.compBandRange)}.`,
        numbers: [],
        evidenceIds: ids,
        thin,
        mustMention: false,
      });
    }
    const outsideBefore = beforeRoute.stats.outcomeShares.outsideLimits;
    const outsideAfter = afterRoute.stats.outcomeShares.outsideLimits;
    if (outsideAfter >= OUTSIDE_LIMITS_MIN && outsideAfter > outsideBefore && afterRoute.stats.reachedN > 0) {
      add({
        kind: "outside_limits",
        archetype: a,
        text: `On ${route(a)}, ${pct(outsideAfter)}% of comparable engineers reached the goal but outside your limits.`,
        numbers: [pct(outsideAfter)],
        evidenceIds: ids,
        thin,
        mustMention: false,
      });
    }
    const added = afterRoute.topRisks.filter(
      (risk) => !beforeRoute.topRisks.includes(risk) && !risk.includes("outside your limits"),
    );
    const removed = beforeRoute.topRisks.filter(
      (risk) => !afterRoute.topRisks.includes(risk) && !risk.includes("outside your limits"),
    );
    for (const [risks, verb] of [
      [added, "now shows"],
      [removed, "no longer shows"],
    ] as const) {
      if (risks.length > 0) {
        add({
          kind: "risk",
          archetype: a,
          text: `${cap(route(a))} ${verb} this risk: ${risks.join(", ")}.`,
          numbers: [],
          evidenceIds: ids,
          thin: false,
          mustMention: false,
        });
      }
    }
  }

  // ---- skills the person newly asked about ----
  const beforeSkills = new Set(before.input.constraints.addSkills);
  for (const skill of after.input.constraints.addSkills.filter((s) => !beforeSkills.has(s))) {
    const perRoute = after.routes.flatMap((r) => {
      const found = r.skills.find((s) => s.skill === skill);
      return found ? [{ r, stats: found.stats, evidenceId: found.evidenceId }] : [];
    });
    if (perRoute.length === 0) continue;
    if (perRoute.every((item) => !item.stats.known)) {
      add({
        kind: "skill",
        archetype: null,
        text: `The cohort has no evidence about "${skill}", so it cannot change any figure here.`,
        numbers: [],
        evidenceIds: perRoute.map((item) => item.evidenceId),
        thin: false, // the sentence already says there is no evidence at all
        mustMention: false,
      });
      continue;
    }
    for (const { r, stats, evidenceId } of perRoute) {
      if (!stats.known) continue;
      const thin = stats.evidenceThin;
      add({
        kind: "skill",
        archetype: r.archetype,
        text:
          `On ${route(r.archetype)}, engineers who proved ${stats.cohortSkill} had a ${rangeText(stats.withSkill.reachedRate)} success range ` +
          `(n=${stats.withSkill.n}) versus ${rangeText(stats.withoutSkill.reachedRate)} without it (n=${stats.withoutSkill.n}); ` +
          `${stats.distinguishable ? "the ranges do not overlap, so the skill is associated with a real difference" : "the ranges overlap, so we cannot tell a difference"}` +
          `${thinText(thin)}.`,
        numbers: [
          ...stats.withSkill.reachedRate.map(pct),
          stats.withSkill.n,
          ...stats.withoutSkill.reachedRate.map(pct),
          stats.withoutSkill.n,
        ],
        evidenceIds: [evidenceId],
        thin,
        mustMention: false,
      });
    }
  }

  return {
    routes,
    twins: { before: before.twins.n, after: after.twins.n },
    recommended,
    facts,
    unchanged: facts.length === 0 && routes.every((r) => r.status === "unchanged"),
  };
}

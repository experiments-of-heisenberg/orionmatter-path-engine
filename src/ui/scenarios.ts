/**
 * scenarios.ts: saved "what if" branches, to compare side by side.
 *
 * A scenario is a set of constraints plus the headline of what it gave (the start-here route, its success
 * range, its typical months, and how many engineers stand behind it). The list is small on purpose
 * (four), lives in the browser only, and every operation here is a pure function that returns a new
 * list, so the panel stays thin and the rules (no duplicates, no more than four, honest "highest") are tested.
 */
import type { ClientSheet } from "../lib/api/serialize";
import type { Constraints } from "../lib/schemas";
import { describeConstraints, normalise, sameConstraints } from "./limits";
import { clip } from "./text";
import { ARCHETYPE_LABEL, monthsRange, percentRange, type Archetype } from "./format";

/** Most scenarios kept at once. */
export const MAX_SCENARIOS = 4;
/** Longest scenario name, in characters. */
export const MAX_NAME = 30;
const LETTERS = ["A", "B", "C", "D"] as const;

/** What a scenario gave, as ranges with counts. Nothing here is a single score. */
export interface Headline {
  /** The start-here route, or null when no route has anyone who met the limits. */
  route: Archetype | null;
  rate: [number, number] | null;
  months: [number, number] | null;
  /** Comparable engineers on that route. */
  n: number;
  /** Of those, how many reached the goal within the limits. */
  reachedN: number;
  thin: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  constraints: Constraints;
  headline: Headline;
}

/** The headline of a fact sheet: its start-here route, or "none" when nobody met the limits. */
export function headlineOf(sheet: ClientSheet): Headline {
  const route = sheet.routes.find((r) => r.archetype === sheet.ranking.recommended);
  if (!route) return { route: null, rate: null, months: null, n: 0, reachedN: 0, thin: true };
  return {
    route: route.archetype,
    rate: route.reachedRate,
    months: route.monthsToGoal,
    n: route.n,
    reachedN: route.reachedN,
    thin: route.evidenceThin,
  };
}

/** One line for a headline: "Jump · 56–78% · 18–23 months · 65 engineers". */
export function headlineText(h: Headline): string {
  if (h.route === null || h.rate === null) return "No route has anyone who met your limits";
  const parts = [ARCHETYPE_LABEL[h.route], percentRange(h.rate)];
  if (h.months) parts.push(monthsRange(h.months));
  parts.push(`${h.n} engineer${h.n === 1 ? "" : "s"}${h.thin ? ", limited evidence" : ""}`);
  return parts.join(" \u00b7 ");
}

/** The constraints in words, or "No limits set". */
export function constraintsText(c: Constraints): string {
  const parts = describeConstraints(c);
  return parts.length > 0 ? parts.join(", ") : "No limits set";
}

export type AddResult =
  | { ok: true; list: Scenario[]; added: Scenario }
  | { ok: false; list: Scenario[]; reason: "full" | "duplicate"; message: string };

/** Save the current settings as a scenario. Refuses when full or when the same settings are already saved. */
export function addScenario(
  list: readonly Scenario[],
  constraints: Constraints,
  sheet: ClientSheet,
): AddResult {
  if (list.length >= MAX_SCENARIOS) {
    return {
      ok: false,
      list: [...list],
      reason: "full",
      message: `You can keep ${MAX_SCENARIOS} scenarios. Remove one to save another.`,
    };
  }
  const same = list.find((s) => sameConstraints(s.constraints, constraints));
  if (same) {
    return {
      ok: false,
      list: [...list],
      reason: "duplicate",
      message: `These settings are already saved as ${same.name}.`,
    };
  }
  const used = new Set(list.map((s) => s.id));
  const letter = LETTERS.find((l) => !used.has(`sc-${l}`)) ?? LETTERS[0];
  const added: Scenario = {
    id: `sc-${letter}`,
    name: `Scenario ${letter}`,
    constraints: normalise(constraints),
    headline: headlineOf(sheet),
  };
  return { ok: true, list: [...list, added], added };
}

/** Remove a scenario. */
export function removeScenario(list: readonly Scenario[], id: string): Scenario[] {
  return list.filter((s) => s.id !== id);
}

/** Rename a scenario. A blank name is ignored; a long one is cut to MAX_NAME. */
export function renameScenario(list: readonly Scenario[], id: string, raw: string): Scenario[] {
  const name = clip(raw.replace(/\s+/g, " ").trim(), MAX_NAME);
  if (name === "") return [...list];
  return list.map((s) => (s.id === id ? { ...s, name } : s));
}

/** Which scenario has the highest middle success, and whether it is clearly ahead (its low end above the runner-up's high end). */
export function leader(list: readonly Scenario[]): { id: string; clear: boolean } | null {
  const ranked = list
    .filter((s) => s.headline.rate !== null)
    .map((s) => ({ id: s.id, rate: s.headline.rate as [number, number] }))
    .sort((a, b) => b.rate[0] + b.rate[1] - (a.rate[0] + a.rate[1]));
  const [first, second] = ranked;
  if (!first || !second) return null;
  if (first.rate[0] + first.rate[1] === second.rate[0] + second.rate[1]) return null; // a tie has no leader
  return { id: first.id, clear: first.rate[0] > second.rate[1] };
}

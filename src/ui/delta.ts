/**
 * delta.ts: what moved between two answers, in words, for the chips under the map.
 *
 * When a slider moves, the map redraws at once, but a redraw alone does not say what changed. This
 * module compares two fact sheets (the starting point and now) and writes one short chip per route that
 * moved, using the same thresholds as the server's own diff so the sentence on screen and the one the
 * What-if agent writes agree. Every figure is a range with its engineer count; the arrow always comes
 * with words ("up 12 points"), so colour is never the only signal. Pure and tested without a browser.
 */
import type { ClientRoute, ClientSheet } from "../lib/api/serialize";
import { ARCHETYPE_LABEL, monthsRange, percentRange, type Archetype } from "./format";

/** Smallest move in the middle of a success range that is worth a chip, in percentage points. Matches the server's RATE_SHIFT_MIN. */
export const RATE_SHIFT_MIN = 5;
/** Smallest move in the middle of a timeline that is worth a chip, in months. Matches the server's MONTHS_SHIFT_MIN. */
export const MONTHS_SHIFT_MIN = 3;

/** Whether a change is good for the person, bad, or mixed. Shown by an icon and a word as well as a colour. */
export type Tone = "better" | "worse" | "mixed" | "neutral";

/** One chip: one route (or the recommendation) and what changed about it. */
export interface DeltaChip {
  /** Stable for a given change, so React can key on it. */
  id: string;
  archetype: Archetype | null;
  tone: Tone;
  /** The whole sentence, with every number as a range and a count. */
  text: string;
}

const mid = (range: readonly [number, number]): number => (range[0] + range[1]) / 2;
const reached = (route: ClientRoute): boolean => route.reachedN > 0;
const engineers = (n: number): string => `${n} engineer${n === 1 ? "" : "s"}`;
const points = (value: number): string =>
  `${Math.abs(Math.round(value))} point${Math.abs(Math.round(value)) === 1 ? "" : "s"}`;

/** The chip for one route, or null when it did not move enough to say. */
export function routeChip(before: ClientRoute, after: ClientRoute): DeltaChip | null {
  const name = ARCHETYPE_LABEL[after.archetype];
  const id = `route-${after.archetype}`;
  if (after.n === 0 && before.n === 0) return null;
  if (reached(before) && !reached(after)) {
    return {
      id,
      archetype: after.archetype,
      tone: "worse",
      text: `${name}: no one finished within your limits now (it was ${percentRange(before.reachedRate)}, ${engineers(before.n)}).`,
    };
  }
  if (!reached(before) && reached(after)) {
    return {
      id,
      archetype: after.archetype,
      tone: "better",
      text: `${name}: now reachable within your limits, ${percentRange(after.reachedRate)} of ${engineers(after.n)} (${monthsRange(after.monthsToGoal)}).`,
    };
  }
  if (!reached(before) && !reached(after)) return null;

  const rateShift = (mid(after.reachedRate) - mid(before.reachedRate)) * 100;
  const monthsShift =
    before.monthsToGoal && after.monthsToGoal ? mid(after.monthsToGoal) - mid(before.monthsToGoal) : null;
  const rateMoved = Math.abs(rateShift) >= RATE_SHIFT_MIN;
  const timeMoved = monthsShift !== null && Math.abs(monthsShift) >= MONTHS_SHIFT_MIN;
  if (!rateMoved && !timeMoved) return null;

  const parts: string[] = [];
  const signals: Tone[] = [];
  if (rateMoved) {
    parts.push(
      `success ${percentRange(before.reachedRate)} to ${percentRange(after.reachedRate)} (${rateShift > 0 ? "up" : "down"} ${points(rateShift)})`,
    );
    signals.push(rateShift > 0 ? "better" : "worse");
  }
  if (timeMoved && monthsShift !== null && before.monthsToGoal && after.monthsToGoal) {
    const m = Math.abs(Math.round(monthsShift));
    parts.push(
      `time ${monthsRange(before.monthsToGoal)} to ${monthsRange(after.monthsToGoal)} (${monthsShift < 0 ? "faster" : "slower"} by about ${m} month${m === 1 ? "" : "s"})`,
    );
    signals.push(monthsShift < 0 ? "better" : "worse");
  }
  const tone: Tone = signals.every((t) => t === "better")
    ? "better"
    : signals.every((t) => t === "worse")
      ? "worse"
      : "mixed";
  return {
    id,
    archetype: after.archetype,
    tone,
    text: `${name}: ${parts.join("; ")}, now based on ${engineers(after.n)}.`,
  };
}

/** Chips for everything that moved from `before` to `after`: the recommendation first, then each route. */
export function deltaChips(before: ClientSheet, after: ClientSheet): DeltaChip[] {
  const chips: DeltaChip[] = [];
  const was = before.ranking.recommended;
  const now = after.ranking.recommended;
  if (was !== now) {
    chips.push({
      id: "recommended",
      archetype: now,
      tone: "neutral",
      text: now
        ? `Start-here route is now ${ARCHETYPE_LABEL[now]}${was ? ` (it was ${ARCHETYPE_LABEL[was]})` : ""}.`
        : "No route has anyone who met your limits, so there is no start-here route now.",
    });
  }
  for (const route of after.routes) {
    const old = before.routes.find((r) => r.archetype === route.archetype);
    if (!old) continue;
    const chip = routeChip(old, route);
    if (chip) chips.push(chip);
  }
  return chips;
}

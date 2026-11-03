/**
 * wouldItTake.ts: "what would it take?" (single-knob relaxations).
 *
 * When a person's constraints leave them with no good route ("Staff within 12 months"), the
 * useful next question is not "why not" but "what is the smallest thing I could give up?".
 * This module searches, for each constraint they have set, for the SMALLEST relaxation of that
 * one constraint that reaches a target:
 *
 *   target: some route has at least `minReached` comparable engineers who reached the goal
 *           within the (relaxed) limits, and a success range centred on at least `minRate`
 *
 *   maxMonths      raise the limit one month at a time (up to the supported maximum)
 *   minCompBand    lower the floor one band at a time, then remove it
 *   remote         turn it off
 *   noRelocation   turn it off
 *
 * Only one knob changes at a time, so each answer is a clean, honest "if you changed just this".
 * If no single change is enough, it says so rather than guessing at combinations. Deterministic
 * (no model) and fast. Every option's sentence is written by code with its numbers listed.
 */
import { gatherEvidence, type EngineInput } from "../engine";
import type { Constraints } from "../schemas";
import { EvidenceLedger } from "../tools/ledger";
import { BANDS } from "../tools/stats";
import { MONTHS_RANGE } from "./apply";
import { headlineMetric, rateMid, type HeadlineMetric } from "./metric";

/** What counts as "a route worth planning around". */
export interface Target {
  /** Fewest comparable engineers who reached the goal within the limits. */
  minReached: number;
  /** Lowest acceptable middle of the success range, as a fraction. */
  minRate: number;
}

/** The default target: ten engineers who made it, and a success range centred on at least 50%. */
export const DEFAULT_TARGET: Target = { minReached: 10, minRate: 0.5 };

/** The constraints a relaxation can change. */
export type RelaxKnob = "maxMonths" | "minCompBand" | "remote" | "noRelocation";

/** One way to reach the target by relaxing one constraint. */
export interface Relaxation {
  knob: RelaxKnob;
  /** Display value before ("12 months", "B5", "on"). */
  from: string;
  /** Display value after ("20 months", "B3", "no floor", "off"). */
  to: string;
  /** Size of the change: months added, bands dropped, or 1 for a switch. */
  steps: number;
  /**
   * The new value, for a program to apply (the display strings above are for people): months for
   * maxMonths, a band or null ("no floor") for minCompBand, and false for the two switches.
   */
  value: number | string | false | null;
  /** What the person would then have. */
  metric: HeadlineMetric;
  /** A sentence written by code. */
  text: string;
  /** Every number in the text. */
  numbers: number[];
}

/** The answer to "what would it take?". */
export interface WhatItTake {
  target: Target;
  /** What the person has now. */
  current: HeadlineMetric;
  /** True when the current constraints already reach the target (nothing to relax). */
  alreadyMet: boolean;
  /** Smallest working relaxation per constraint, best resulting success first. Empty when none works. */
  options: Relaxation[];
  /** A plain sentence when `options` is empty and the target is not already met. */
  note?: string;
}

/** Whether a metric reaches a target. */
export function meetsTarget(metric: HeadlineMetric, target: Target): boolean {
  return metric.route !== null && metric.reachedN >= target.minReached && rateMid(metric) >= target.minRate;
}

const pct = (value: number): number => Math.round(value * 100);

/** The sentence for a relaxation, and the numbers it uses. */
function describe(
  knob: RelaxKnob,
  from: string,
  to: string,
  metric: HeadlineMetric,
): { text: string; numbers: number[] } {
  const action: Record<RelaxKnob, string> = {
    maxMonths: `Raise your time limit from ${from} to ${to}`,
    minCompBand: `Lower your minimum pay band from ${from} to ${to}`,
    remote: "Drop the remote-only requirement",
    noRelocation: "Allow relocation",
  };
  const route = metric.route ?? "best";
  const text =
    `${action[knob]}: the ${route} route would then have ${metric.reachedN} comparable engineers who ` +
    `reached the goal within your limits, a ${pct(metric.rate[0])}-${pct(metric.rate[1])}% success range` +
    `${metric.thin ? " (limited evidence)" : ""}.`;
  // Months and band labels carry digits too, so list the plain numbers that appear as words.
  const numbers = [
    ...(knob === "maxMonths" ? [Number.parseInt(from, 10), Number.parseInt(to, 10)] : []),
    metric.reachedN,
    pct(metric.rate[0]),
    pct(metric.rate[1]),
  ];
  return { text, numbers };
}

/**
 * Find the smallest single-constraint relaxations that reach the target.
 *
 * @param input the person, goal and current constraints
 * @param target what counts as a route worth planning around
 */
export function whatWouldItTake(input: EngineInput, target: Target = DEFAULT_TARGET): WhatItTake {
  const ledger = new EvidenceLedger();
  const current = input.constraints;
  const measure = (patch: Partial<Constraints>, drop: (keyof Constraints)[] = []): HeadlineMetric => {
    const constraints: Constraints = { ...current, ...patch };
    for (const key of drop) delete constraints[key];
    return headlineMetric(gatherEvidence(ledger, { ...input, constraints }));
  };

  const now = measure({});
  if (meetsTarget(now, target)) return { target, current: now, alreadyMet: true, options: [] };

  const options: Relaxation[] = [];
  const add = (
    knob: RelaxKnob,
    from: string,
    to: string,
    steps: number,
    metric: HeadlineMetric,
    value: Relaxation["value"],
  ): void => {
    options.push({ knob, from, to, steps, value, metric, ...describe(knob, from, to, metric) });
  };

  if (current.maxMonths !== undefined) {
    for (let months = current.maxMonths + 1; months <= MONTHS_RANGE.max; months++) {
      const metric = measure({ maxMonths: months });
      if (meetsTarget(metric, target)) {
        add(
          "maxMonths",
          `${current.maxMonths} months`,
          `${months} months`,
          months - current.maxMonths,
          metric,
          months,
        );
        break;
      }
    }
  }

  if (current.minCompBand !== undefined) {
    const from = BANDS.findIndex((band) => band === current.minCompBand);
    for (let band = from - 1, dropped = 1; band >= -1; band--, dropped++) {
      const metric = band < 0 ? measure({}, ["minCompBand"]) : measure({ minCompBand: BANDS[band] });
      if (meetsTarget(metric, target)) {
        add(
          "minCompBand",
          current.minCompBand,
          band < 0 ? "no floor" : (BANDS[band] as string),
          dropped,
          metric,
          band < 0 ? null : (BANDS[band] as string),
        );
        break;
      }
    }
  }

  for (const knob of ["remote", "noRelocation"] as const) {
    if (current[knob]) {
      const metric = measure({ [knob]: false });
      if (meetsTarget(metric, target)) add(knob, "on", "off", 1, metric, false);
    }
  }

  options.sort((a, b) => rateMid(b.metric) - rateMid(a.metric));
  const note =
    options.length === 0
      ? "No single change to your constraints is enough: even with one of them relaxed, no route has enough comparable engineers who reached the goal. Relaxing several together, or a different goal, may be needed."
      : undefined;
  return { target, current: now, alreadyMet: false, options, ...(note ? { note } : {}) };
}

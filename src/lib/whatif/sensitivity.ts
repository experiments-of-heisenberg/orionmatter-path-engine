/**
 * sensitivity.ts: which constraint matters most? (the "tornado")
 *
 * For each knob that can change how likely the goal is, hold everything else at the person's
 * current settings, try each alternative value for that one knob, and measure the headline
 * metric (the best route's success range). The knob whose alternatives move the metric most
 * goes on top: the widest bar of the tornado.
 *
 *   remote, noRelocation, maxMonths, minCompBand  ->  measured here
 *   riskTolerance                                 ->  reorders routes, does not change any rate
 *   addSkills                                     ->  a with/without comparison, no change to rates
 * The last two are left out on purpose, not forgotten: a bar of zero width would only suggest
 * they do nothing, when in fact they change something a success rate cannot show.
 *
 * Fully deterministic (no model) and fast, so the interface can compute it on every change.
 */
import { gatherEvidence, type EngineInput } from "../engine";
import type { Constraints } from "../schemas";
import { EvidenceLedger } from "../tools/ledger";
import { BANDS } from "../tools/stats";
import { headlineMetric, rateMid, type HeadlineMetric } from "./metric";

/** The knobs the tornado measures. */
export type TornadoKnob = "remote" | "noRelocation" | "maxMonths" | "minCompBand";

/** Time limits tried, in months. The person's own limit is always added. */
export const MONTH_OPTIONS = [12, 18, 24, 36, 48, 60] as const;

/** One alternative value of one knob, and what it does to the headline metric. */
export interface TornadoOption {
  /** Display value: "on", "off", "24 months", "B4", "no limit". */
  label: string;
  /** True for the value the person has now. */
  current: boolean;
  metric: HeadlineMetric;
}

/** One bar: a knob, every value tried, and how far they spread the metric. */
export interface TornadoBar {
  knob: TornadoKnob;
  /** Plain name of the knob, for display. */
  label: string;
  /** Every value tried, in the order they are listed in the knob's natural scale. */
  options: TornadoOption[];
  /** The option with the lowest success (ties: the first listed). */
  worst: TornadoOption;
  /** The option with the highest success (ties: the first listed). */
  best: TornadoOption;
  /** Distance between best and worst, in percentage points of the middle of the success range. */
  swing: number;
}

/** The whole tornado. */
export interface Tornado {
  /** What the person has now. */
  baseline: HeadlineMetric;
  /** Widest swing first; ties keep the order remote, noRelocation, maxMonths, minCompBand. */
  bars: TornadoBar[];
}

const LABELS: Record<TornadoKnob, string> = {
  remote: "Remote only",
  noRelocation: "No relocation",
  maxMonths: "Time limit",
  minCompBand: "Minimum pay band",
};

/** Compute the headline metric for the person's constraints with a patch applied. */
function measure(
  ledger: EvidenceLedger,
  input: EngineInput,
  patch: Partial<Constraints>,
  drop: (keyof Constraints)[] = [],
) {
  const constraints: Constraints = { ...input.constraints, ...patch };
  for (const key of drop) delete constraints[key];
  return headlineMetric(gatherEvidence(ledger, { ...input, constraints }));
}

/**
 * Measure how much each knob matters for this person.
 *
 * @param input the person, goal and current constraints
 */
export function sensitivityTornado(input: EngineInput): Tornado {
  const ledger = new EvidenceLedger();
  const current = input.constraints;
  const baseline = measure(ledger, input, {});

  const toBar = (knob: TornadoKnob, options: TornadoOption[]): TornadoBar => {
    const mids = options.map((option) => rateMid(option.metric));
    const lowest = Math.min(...mids);
    const highest = Math.max(...mids);
    return {
      knob,
      label: LABELS[knob],
      options,
      worst: options[mids.indexOf(lowest)] as TornadoOption,
      best: options[mids.indexOf(highest)] as TornadoOption,
      swing: Math.round((highest - lowest) * 100),
    };
  };

  const booleanBar = (knob: "remote" | "noRelocation"): TornadoBar =>
    toBar(
      knob,
      [false, true].map((value) => ({
        label: value ? "on" : "off",
        current: Boolean(current[knob]) === value,
        metric: Boolean(current[knob]) === value ? baseline : measure(ledger, input, { [knob]: value }),
      })),
    );

  const months = [
    ...new Set([...MONTH_OPTIONS, ...(current.maxMonths !== undefined ? [current.maxMonths] : [])]),
  ].sort((a, b) => a - b);
  const monthsBar = toBar("maxMonths", [
    ...months.map((value) => ({
      label: `${value} months`,
      current: current.maxMonths === value,
      metric: current.maxMonths === value ? baseline : measure(ledger, input, { maxMonths: value }),
    })),
    {
      label: "no limit",
      current: current.maxMonths === undefined,
      metric: current.maxMonths === undefined ? baseline : measure(ledger, input, {}, ["maxMonths"]),
    },
  ]);

  const bandsBar = toBar("minCompBand", [
    {
      label: "no floor",
      current: current.minCompBand === undefined,
      metric: current.minCompBand === undefined ? baseline : measure(ledger, input, {}, ["minCompBand"]),
    },
    ...BANDS.slice(2).map((band) => ({
      label: band,
      current: current.minCompBand === band,
      metric: current.minCompBand === band ? baseline : measure(ledger, input, { minCompBand: band }),
    })),
  ]);

  const bars = [booleanBar("remote"), booleanBar("noRelocation"), monthsBar, bandsBar]
    .map((bar, index) => ({ bar, index }))
    .sort((a, b) => b.bar.swing - a.bar.swing || a.index - b.index)
    .map((item) => item.bar);
  return { baseline, bars };
}

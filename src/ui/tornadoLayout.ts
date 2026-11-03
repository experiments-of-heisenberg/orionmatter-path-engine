/**
 * tornadoLayout.ts: the geometry of the "what matters most" chart.
 *
 * One row per setting (time limit, pay floor, remote, relocation). A bar runs from the worst value of
 * that setting to the best, on a 0 to 100 scale of the middle of the success range, so the widest bar is the
 * setting that moves the odds most. Every value is labelled with its own range and engineer count, and
 * the person's current value is marked. Rows where no route had anyone who met the limits are drawn at
 * zero and labelled "none within your limits" rather than being given an invented number.
 */
import type { Tornado, TornadoBar, TornadoOption } from "../lib/whatif";
import { percentRange } from "./format";

export interface TornadoRow {
  knob: TornadoBar["knob"];
  label: string;
  /** Bar ends as fractions of the width, 0 to 1. */
  from: number;
  to: number;
  /** Where the current value sits, 0 to 1, or null when the current value was not among those tried. */
  current: number | null;
  swing: number;
  worst: { label: string; text: string };
  best: { label: string; text: string };
  /** Every value tried, in words, for screen readers and the table fallback. */
  options: { label: string; text: string; current: boolean }[];
}

/** Middle of an option's success range as a fraction; 0 when no route had anyone who met the limits. */
export function optionMid(option: TornadoOption): number {
  return option.metric.route === null ? 0 : (option.metric.rate[0] + option.metric.rate[1]) / 2;
}

/** An option's range and count in words. */
export function optionText(option: TornadoOption): string {
  const { metric } = option;
  if (metric.route === null) return "none within your limits";
  const people = `${metric.reachedN} of ${metric.n} engineers`;
  return `${percentRange(metric.rate)}, ${people}${metric.thin ? ", limited evidence" : ""}`;
}

/** Rows for the chart, widest swing first (the order the tornado already has). */
export function tornadoRows(tornado: Tornado): TornadoRow[] {
  return tornado.bars.map((bar) => {
    const current = bar.options.find((o) => o.current);
    const lo = optionMid(bar.worst);
    const hi = optionMid(bar.best);
    return {
      knob: bar.knob,
      label: bar.label,
      from: Math.min(lo, hi),
      to: Math.max(lo, hi),
      current: current ? optionMid(current) : null,
      swing: bar.swing,
      worst: { label: bar.worst.label, text: optionText(bar.worst) },
      best: { label: bar.best.label, text: optionText(bar.best) },
      options: bar.options.map((o) => ({ label: o.label, text: optionText(o), current: o.current })),
    };
  });
}

/** One sentence for the whole chart, for screen readers: which setting matters most and by how much. */
export function tornadoSummary(rows: readonly TornadoRow[]): string {
  const top = rows[0];
  if (!top) return "No setting changes the odds.";
  if (top.swing < 1) return "None of these settings changes the odds for the start-here route.";
  return `${top.label} matters most: from ${top.worst.label} (${top.worst.text}) to ${top.best.label} (${top.best.text}), a swing of about ${Math.round(top.swing)} points.`;
}

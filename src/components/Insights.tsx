/**
 * Insights.tsx: three short panels that answer "so what changed, what matters, and what would help?".
 *
 * - DeltaChips: what moved since the starting point, one sentence per route, with numbers as ranges.
 * - TornadoPanel: which of your limits moves the odds most, drawn as one bar per limit from its worst value to
 *   its best, with the range and engineer count at each end and a text list of every value tried.
 * - WhatItTakePanel: when your limits leave little room, the smallest single change that would help, with a
 *   button to try it. It never combines changes and says so when no single change is enough.
 * All three are drawn from numbers the server computed with no model; none of them can be wrong in a way a model could make them wrong.
 */
"use client";
import type { Relaxation, Tornado, WhatItTake } from "../lib/whatif";
import { ARCHETYPE_LABEL, percentRange } from "../ui/format";
import type { DeltaChip, Tone } from "../ui/delta";
import { tornadoRows, tornadoSummary } from "../ui/tornadoLayout";

const TONE_MARK: Record<Tone, string> = {
  better: "\u25b2",
  worse: "\u25bc",
  mixed: "\u25c6",
  neutral: "\u25cf",
};
const TONE_WORD: Record<Tone, string> = { better: "Better", worse: "Worse", mixed: "Mixed", neutral: "Note" };

/** What changed since the starting point. */
export function DeltaChips({ chips, startingPoint }: { chips: readonly DeltaChip[]; startingPoint: string }) {
  return (
    <section className="deltas" aria-labelledby="deltas-title">
      <h2 className="deltas__title" id="deltas-title">
        What changed
        <span className="deltas__since">since {startingPoint}</span>
      </h2>
      {chips.length === 0 ? (
        <p className="deltas__none">Nothing has moved enough to report yet. Try a limit.</p>
      ) : (
        <ul className="deltas__list" aria-live="polite">
          {chips.map((chip) => (
            <li key={chip.id} className={`delta delta--${chip.tone}`}>
              <span className="delta__mark" aria-hidden="true">
                {TONE_MARK[chip.tone]}
              </span>
              <span className="sr-only">{TONE_WORD[chip.tone]}: </span>
              {chip.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Which limit matters most. */
export function TornadoPanel({ tornado }: { tornado: Tornado }) {
  const rows = tornadoRows(tornado);
  const base = tornado.baseline;
  return (
    <section className="panel" aria-labelledby="tornado-title">
      <h2 className="panel__title" id="tornado-title">
        Which limit matters most
      </h2>
      <p className="panel__lede">
        Each bar runs from the worst to the best value of one limit, holding the others as they are now. The
        wider the bar, the more that limit moves your odds on the start-here route.
        {base.route
          ? ` Right now: ${ARCHETYPE_LABEL[base.route]}, ${percentRange(base.rate)} of ${base.n} engineers.`
          : " Right now no route has anyone who met your limits."}
      </p>
      <p className="sr-only">{tornadoSummary(rows)}</p>
      <ul className="tornado">
        {rows.map((row) => (
          <li key={row.knob} className="tornado__row">
            <div className="tornado__head">
              <span className="tornado__label">{row.label}</span>
              <span className="tornado__swing">
                {row.swing < 1 ? "no effect" : `swing ${Math.round(row.swing)} points`}
              </span>
            </div>
            <div className="tornado__track" aria-hidden="true">
              <span
                className="tornado__bar"
                style={{ left: `${row.from * 100}%`, width: `${Math.max(0.8, (row.to - row.from) * 100)}%` }}
              />
              {row.current !== null && (
                <span className="tornado__now" style={{ left: `${row.current * 100}%` }} />
              )}
            </div>
            <div className="tornado__ends">
              <span>
                <strong>Worst:</strong> {row.worst.label}, {row.worst.text}
              </span>
              <span>
                <strong>Best:</strong> {row.best.label}, {row.best.text}
              </span>
            </div>
            <details className="tornado__all">
              <summary>Every value tried</summary>
              <ul>
                {row.options.map((o) => (
                  <li key={o.label}>
                    {o.label}
                    {o.current ? " (yours now)" : ""}: {o.text}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <p className="panel__fine">
        The scale is the middle of the success range, 0 to 100 percent. The black mark shows where you are
        now. Risk tolerance and skills are not shown: they reorder routes or compare groups, and a bar would
        suggest they do nothing.
      </p>
    </section>
  );
}

/** The smallest single change that would help. */
export function WhatItTakePanel({
  data,
  onApply,
}: {
  data: WhatItTake;
  onApply: (relaxation: Relaxation) => void;
}) {
  return (
    <section className="panel" aria-labelledby="take-title">
      <h2 className="panel__title" id="take-title">
        What would it take
      </h2>
      {data.alreadyMet ? (
        <p className="panel__lede">
          Your limits already leave a route with at least {data.target.minReached} comparable engineers who
          made it and a success range centred on {Math.round(data.target.minRate * 100)}% or more. Nothing
          needs to give.
        </p>
      ) : data.options.length === 0 ? (
        <p className="panel__lede">{data.note}</p>
      ) : (
        <>
          <p className="panel__lede">
            Your limits leave little room. These are the smallest single changes that bring a route to at
            least {data.target.minReached} comparable engineers who made it and a success range centred on{" "}
            {Math.round(data.target.minRate * 100)}% or more. One change at a time; no combinations.
          </p>
          <ul className="take">
            {data.options.map((o) => (
              <li key={o.knob} className="take__card">
                <p className="take__text">{o.text}</p>
                <button type="button" className="button" onClick={() => onApply(o)}>
                  Try this
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

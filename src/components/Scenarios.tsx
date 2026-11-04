/**
 * Scenarios.tsx: save the current limits as a branch and compare branches side by side.
 *
 * A scenario is kept in the browser only. The comparison is a plain table (one row per scenario, each
 * figure a range with its engineer count) and a note on which scenario is highest that says plainly when the
 * ranges overlap, because "highest middle" is not "better" when the ranges cannot be told apart.
 */
"use client";
import { useState } from "react";
import {
  MAX_NAME,
  MAX_SCENARIOS,
  constraintsText,
  headlineText,
  leader,
  type Scenario,
} from "../ui/scenarios";
import { h } from "../ui/display";

export interface ScenariosProps {
  scenarios: readonly Scenario[];
  /** A short message about the last save attempt, such as "already saved". */
  notice: string | undefined;
  onSave: () => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function NameField({ scenario, onRename }: { scenario: Scenario; onRename: (name: string) => void }) {
  const [value, setValue] = useState(scenario.name);
  return (
    <input
      className="input input--inline"
      aria-label={`Name of ${scenario.name}`}
      value={value}
      maxLength={MAX_NAME}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onRename(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function Scenarios({ scenarios, notice, onSave, onOpen, onRemove, onRename }: ScenariosProps) {
  const top = leader(scenarios);
  return (
    <section className="panel" aria-labelledby="scenarios-title">
      <div className="controls__head">
        <h2 className="panel__title" id="scenarios-title">
          Scenarios
        </h2>
        <button
          type="button"
          className="button"
          onClick={onSave}
          disabled={scenarios.length >= MAX_SCENARIOS}
        >
          Save these limits
        </button>
      </div>
      <p className="panel__lede">
        Save a set of limits, change them, save another, and compare. You can keep {MAX_SCENARIOS}. They stay
        in this browser only.
      </p>
      {notice && (
        <p className="notice notice--inline" role="status">
          {notice}
        </p>
      )}
      {scenarios.length === 0 ? (
        <p className="panel__fine">Nothing saved yet.</p>
      ) : (
        <>
          <div className="compare__table-wrap">
            <table className="compare__table scenarios__table">
              <caption className="sr-only">Saved scenarios side by side</caption>
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Limits</th>
                  <th scope="col">What it gave</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.id} className={top?.id === s.id ? "scenario--top" : undefined}>
                    <th scope="row">
                      <div className="scenario__name">
                        <NameField
                          key={`${s.id}-${s.name}`}
                          scenario={s}
                          onRename={(name) => onRename(s.id, name)}
                        />
                        {top?.id === s.id && (
                          <span className="tag tag--start">
                            {top.clear ? "Highest, clearly" : "Highest, ranges overlap"}
                          </span>
                        )}
                      </div>
                    </th>
                    <td>{h(constraintsText(s.constraints))}</td>
                    <td>{h(headlineText(s.headline))}</td>
                    <td className="scenarios__actions">
                      <button type="button" className="button button--quiet" onClick={() => onOpen(s.id)}>
                        Open
                      </button>
                      <button
                        type="button"
                        className="button button--quiet"
                        aria-label={`Remove ${s.name}`}
                        onClick={() => onRemove(s.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {top && (
            <p className="panel__fine">
              {top.clear
                ? "The highest scenario is clearly ahead: its lowest figure is above the next one's highest."
                : "The highest middle is not a clear win: the ranges overlap, so the data cannot tell these scenarios apart."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

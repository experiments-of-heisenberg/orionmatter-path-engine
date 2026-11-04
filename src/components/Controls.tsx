/**
 * Controls.tsx: the sliders and switches that edit the person's limits.
 *
 * Every control is a real form control with a visible label, so it works with a keyboard and a screen
 * reader with no extra effort: a range input for the time limit (its last stop is "No limit"), a row of
 * buttons for the pay floor and the risk setting, switches for remote and relocation, and a small list of
 * skills to ask about. The panel holds no state: it shows `constraints` and calls `onChange` with a new,
 * normalised copy (see ui/limits.ts), so the parent decides when to recompute.
 */
"use client";
import { useState } from "react";
import { MAX_SKILLS } from "../lib/limits";
import type { Constraints } from "../lib/schemas";
import {
  BAND_OPTIONS,
  LIMIT_MAX,
  LIMIT_MIN,
  NO_LIMIT,
  RISK_OPTIONS,
  cleanSkill,
  limitLabel,
  limitToSlider,
  sliderToLimit,
  withFlag,
  withLimit,
  withMinBand,
  withRisk,
  withSkillAdded,
  withSkillRemoved,
} from "../ui/limits";

export interface ControlsProps {
  constraints: Constraints;
  onChange: (next: Constraints) => void;
  onReset: () => void;
  /** True when the settings are not the starting ones, so Reset has something to do. */
  canReset: boolean;
}

/** A button that acts as one choice in a group of exclusive choices. */
function Choice({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="choice" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

/** A labelled on/off switch. */
function Switch({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={onToggle}>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        <span className="switch__hint">{hint}</span>
      </span>
    </button>
  );
}

export function Controls({ constraints: c, onChange, onReset, canReset }: ControlsProps) {
  const [skill, setSkill] = useState("");
  const position = limitToSlider(c.maxMonths);
  const full = c.addSkills.length >= MAX_SKILLS;
  const addSkill = (): void => {
    if (cleanSkill(skill) === "") return;
    onChange(withSkillAdded(c, skill));
    setSkill("");
  };
  return (
    <section className="panel controls" aria-labelledby="controls-title">
      <div className="controls__head">
        <h2 className="panel__title" id="controls-title">
          Your limits
        </h2>
        <button type="button" className="button button--quiet" onClick={onReset} disabled={!canReset}>
          Reset
        </button>
      </div>
      <p className="panel__lede">
        Move anything. The map redraws at once; every number is recomputed from the cohort.
      </p>

      <div className="control">
        <div className="control__row">
          <label htmlFor="limit-slider" className="control__label">
            Time limit
          </label>
          <output htmlFor="limit-slider" className="control__value">
            {limitLabel(c.maxMonths)}
          </output>
        </div>
        <input
          id="limit-slider"
          className="slider"
          type="range"
          min={LIMIT_MIN}
          max={NO_LIMIT}
          step={1}
          value={position}
          aria-valuetext={limitLabel(c.maxMonths)}
          onChange={(event) => onChange(withLimit(c, sliderToLimit(Number(event.target.value))))}
        />
        <div className="slider__scale" aria-hidden="true">
          <span>{LIMIT_MIN} mo</span>
          <span>{LIMIT_MAX} mo</span>
          <span>No limit</span>
        </div>
      </div>

      <div className="control" role="group" aria-labelledby="band-label">
        <p className="control__label" id="band-label">
          Lowest pay band you would accept
        </p>
        <div className="choices">
          <Choice pressed={c.minCompBand === undefined} onClick={() => onChange(withMinBand(c, undefined))}>
            Any
          </Choice>
          {BAND_OPTIONS.map((band) => (
            <Choice
              key={band}
              pressed={c.minCompBand === band}
              onClick={() => onChange(withMinBand(c, band))}
            >
              {band}
            </Choice>
          ))}
        </div>
      </div>

      <div className="control control--switches">
        <Switch
          label="Remote only"
          hint="Roles that can be done remotely"
          on={c.remote === true}
          onToggle={() => onChange(withFlag(c, "remote", c.remote !== true))}
        />
        <Switch
          label="No relocation"
          hint="Stay where you are"
          on={c.noRelocation === true}
          onToggle={() => onChange(withFlag(c, "noRelocation", c.noRelocation !== true))}
        />
      </div>

      <div className="control" role="group" aria-labelledby="risk-label">
        <p className="control__label" id="risk-label">
          Risk you will accept
        </p>
        <div className="choices">
          {RISK_OPTIONS.map((risk) => (
            <Choice
              key={risk.value}
              pressed={c.riskTolerance === risk.value}
              onClick={() => onChange(withRisk(c, risk.value))}
            >
              {risk.label}
            </Choice>
          ))}
        </div>
      </div>

      <div className="control">
        <label className="control__label" htmlFor="skill-input">
          Skills to ask about
        </label>
        {c.addSkills.length > 0 && (
          <ul className="skill-chips" aria-label="Skills you are asking about">
            {c.addSkills.map((s) => (
              <li key={s} className="chip">
                {s}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`Stop asking about ${s}`}
                  onClick={() => onChange(withSkillRemoved(c, s))}
                >
                  <span aria-hidden="true">{"\u00d7"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="skill-form"
          onSubmit={(event) => {
            event.preventDefault();
            addSkill();
          }}
        >
          <input
            id="skill-input"
            className="input"
            type="text"
            value={skill}
            maxLength={40}
            placeholder={full ? `Up to ${MAX_SKILLS} skills` : "For example rust"}
            disabled={full}
            onChange={(event) => setSkill(event.target.value)}
          />
          <button type="submit" className="button" disabled={full || cleanSkill(skill) === ""}>
            Add
          </button>
        </form>
        <p className="panel__fine">
          Skills show how many comparable engineers who had them reached the goal. That is an association, not
          a cause.
        </p>
      </div>
    </section>
  );
}

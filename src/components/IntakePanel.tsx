/**
 * IntakePanel.tsx: the "Your story" tab.
 *
 * Two ways in: write a few lines, or upload a cropped screenshot. Either way the result is a form the person checks,
 * never a fact: each field says where it came from (their own quoted words, their screenshot, a mapping, or their own
 * hand), anything the agent proposed but code refused is listed with the reason, and every required field can be
 * filled by hand. Nothing is verified, and the panel says so. Confirming turns the form into the person the rest
 * of the app uses.
 */
import { useRef, useState } from "react";
import type { REQUIRED_WORDS } from "../ui/intake";
import {
  MAX_INTAKE,
  CROP_WARNING,
  GOAL_LABEL,
  LEVEL_OPTIONS,
  REGION_OPTIONS,
  ROLE_OPTIONS,
  fieldSource,
  missingFields,
  withGoalLevel,
  withStackAdded,
  withStackRemoved,
} from "../ui/intake";
import { REGION_LABEL, ROLE_LABEL } from "../ui/sample";
import type { IntakeBindings } from "./useIntake";

function Source({ b, keys }: { b: IntakeBindings; keys: string }) {
  if (!b.result) return null;
  return <p className="field__source">{fieldSource(keys, b.result.provenance, b.edited)}</p>;
}

export function IntakePanel({ b }: { b: IntakeBindings }) {
  const [tech, setTech] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const reading = b.phase === "reading";
  const missing = new Set<string>(missingFields(b.form));
  const needsInfo = b.result?.status === "needs_info";
  const field = (key: keyof typeof REQUIRED_WORDS) =>
    missing.has(key) ? <span className="field__needed">Needed</span> : null;
  return (
    <div className="intake">
      <section className="panel" aria-labelledby="intake-title">
        <h2 className="panel__title" id="intake-title">
          Tell us about your career
        </h2>
        <p className="panel__lede">
          Write a few lines about where you are and where you want to go, or upload a cropped screenshot of
          your profile. Muse Spark reads it and fills in the form below. Nothing it reads is verified: you
          check and confirm every field before any route is computed.
        </p>
        <label className="control__label" htmlFor="intake-text">
          Your career in a few lines
        </label>
        <textarea
          id="intake-text"
          className="input input--area"
          rows={5}
          value={b.text}
          maxLength={MAX_INTAKE + 200}
          placeholder="For example: I'm a senior backend engineer with 7 years of experience in southern India, working with Go and Kubernetes. I'd like to become a Staff Engineer."
          aria-invalid={b.problem ? true : undefined}
          aria-describedby={b.problem ? "intake-problem" : undefined}
          onChange={(e) => b.onText(e.target.value)}
        />
        <div className="intake__upload">
          <div className="notice" id="crop-warning">
            <p>
              <strong>Before you upload a screenshot.</strong> {CROP_WARNING}
            </p>
          </div>
          <label className="control__label" htmlFor="intake-file">
            Or upload a cropped screenshot
          </label>
          <input
            id="intake-file"
            ref={fileInput}
            className="input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby="crop-warning"
            onChange={(e) => b.onFile(e.target.files?.[0])}
          />
          {b.image && (
            <p className="intake__file">
              <span>Ready to read: {b.image.name}</span>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  b.onClearImage();
                  // Empty the picker too: choosing the same file again fires no change event if it still holds it.
                  // The Remove button is about to disappear, so keep keyboard focus by moving it to the picker.
                  if (fileInput.current) {
                    fileInput.current.value = "";
                    fileInput.current.focus();
                  }
                }}
              >
                Remove picture
              </button>
            </p>
          )}
        </div>
        <div className="chat__actions">
          <span className="chat__count" aria-hidden="true">
            {b.text.length}/{MAX_INTAKE}
          </span>
          <button type="button" className="button button--primary" disabled={reading} onClick={b.onRead}>
            {reading ? "Reading\u2026" : "Read it"}
          </button>
        </div>
        {b.problem && (
          <p id="intake-problem" className="turn__error" role="alert">
            {b.problem}
          </p>
        )}
        {reading && (
          <p className="plan__status" role="status">
            {b.stage}
          </p>
        )}
        {b.phase === "error" && (
          <div className="notice notice--error" role="alert">
            <p>{b.error}</p>
            <button type="button" className="button" onClick={b.onRead}>
              Try again
            </button>
          </div>
        )}
      </section>

      {b.result && (
        <section className="panel" aria-labelledby="read-title">
          <h2 className="panel__title" id="read-title">
            What was read
          </h2>
          {b.result.status === "nothing_found" && (
            <p className="notice">
              Nothing about your career could be found in that. Try again with a few more lines, or fill in
              the form below by hand.
            </p>
          )}
          {b.result.status === "complete" && (
            <p className="panel__lede">
              Everything the routes need was found. Please check each field below.
            </p>
          )}
          {b.result.status === "needs_info" && (
            <p className="panel__lede">
              Some details are still missing. Answer below, or fill them in by hand in the form.
            </p>
          )}
          {b.result.warnings.length > 0 && (
            <ul className="issues issues--warn" aria-label="Things to know">
              {b.result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {b.result.discarded.length > 0 && (
            <>
              <h3 className="panel__sub">Read but not used</h3>
              <ul className="issues">
                {b.result.discarded.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </>
          )}
          {needsInfo && (
            <div className="question" role="group" aria-label="Questions about what is missing">
              {b.result.questions.map((q) => (
                <p key={q} className="question__text">
                  {q}
                </p>
              ))}
              <label className="control__label" htmlFor="intake-answer">
                Your answer
              </label>
              <textarea
                id="intake-answer"
                className="input input--area"
                rows={2}
                value={b.answer}
                onChange={(e) => b.onAnswer(e.target.value)}
              />
              <button type="button" className="button" disabled={reading} onClick={b.onSendAnswer}>
                Send answer
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel" aria-labelledby="confirm-title">
        <h2 className="panel__title" id="confirm-title">
          Check and confirm
        </h2>
        <p className="panel__lede">
          These are the details the routes will be computed from. Change anything that is wrong.{" "}
          {b.result ? "Under each field is where it came from." : ""}
        </p>
        <div className="form-grid">
          <div className="control">
            <label className="control__label" htmlFor="f-role">
              Role {field("roleFamily")}
            </label>
            <select
              id="f-role"
              className="input input--select"
              value={b.form.roleFamily}
              onChange={(e) => b.onForm((f) => ({ ...f, roleFamily: e.target.value }))}
            >
              <option value="">{"Choose\u2026"}</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <Source b={b} keys="roleFamily" />
          </div>
          <div className="control">
            <label className="control__label" htmlFor="f-level">
              Current level {field("level")}
            </label>
            <select
              id="f-level"
              className="input input--select"
              value={b.form.level}
              onChange={(e) => b.onForm((f) => ({ ...f, level: e.target.value }))}
            >
              <option value="">{"Choose\u2026"}</option>
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <Source b={b} keys="level" />
          </div>
          <div className="control">
            <label className="control__label" htmlFor="f-years">
              Years of experience {field("years")}
            </label>
            <input
              id="f-years"
              className="input"
              type="number"
              min={0}
              max={40}
              step={0.5}
              inputMode="decimal"
              value={b.form.years}
              onChange={(e) => b.onForm((f) => ({ ...f, years: e.target.value }))}
            />
            <Source b={b} keys="yearsExperience" />
          </div>
          <div className="control">
            <label className="control__label" htmlFor="f-region">
              Region {field("region")}
            </label>
            <select
              id="f-region"
              className="input input--select"
              value={b.form.region}
              onChange={(e) => b.onForm((f) => ({ ...f, region: e.target.value }))}
            >
              <option value="">{"Choose\u2026"}</option>
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABEL[r] ?? r}
                </option>
              ))}
            </select>
            <Source b={b} keys="region" />
          </div>
          <div className="control">
            <label className="control__label" htmlFor="f-goal">
              Goal level {field("goalLevel")}
            </label>
            <select
              id="f-goal"
              className="input input--select"
              value={b.form.goalLevel}
              onChange={(e) => b.onForm((f) => withGoalLevel(f, e.target.value))}
            >
              <option value="">{"Choose\u2026"}</option>
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l} ({GOAL_LABEL[l]})
                </option>
              ))}
            </select>
            <Source b={b} keys="goal" />
          </div>
          <div className="control">
            <label className="control__label" htmlFor="f-goal-label">
              What you call that goal
            </label>
            <input
              id="f-goal-label"
              className="input"
              type="text"
              maxLength={60}
              value={b.form.goalLabel}
              onChange={(e) => b.onForm((f) => ({ ...f, goalLabel: e.target.value }))}
            />
          </div>
        </div>
        <div className="control">
          <label className="control__label" htmlFor="f-tech">
            Technologies you work with
          </label>
          {b.form.stack.length > 0 && (
            <ul className="skill-chips" aria-label="Your technologies">
              {b.form.stack.map((s) => (
                <li key={s} className="chip">
                  {s}
                  <button
                    type="button"
                    className="chip__remove"
                    aria-label={`Remove ${s}`}
                    onClick={() => b.onForm((f) => withStackRemoved(f, s))}
                  >
                    <span aria-hidden="true">{"\u00d7"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="skill-form"
            onSubmit={(e) => {
              e.preventDefault();
              b.onForm((f) => withStackAdded(f, tech));
              setTech("");
            }}
          >
            <input
              id="f-tech"
              className="input"
              type="text"
              maxLength={40}
              value={tech}
              placeholder="For example go"
              onChange={(e) => setTech(e.target.value)}
            />
            <button
              type="submit"
              className="button"
              disabled={tech.trim() === "" || b.form.stack.length >= 15}
            >
              Add
            </button>
          </form>
          <Source b={b} keys="stack" />
        </div>
        {b.confirmProblems.length > 0 && (
          <ul className="issues issues--warn" role="alert" aria-label="Fix these first">
            {b.confirmProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="chat__actions">
          <span className="panel__fine">Nothing here is verified. It is only what you told us.</span>
          <button type="button" className="button button--primary" onClick={b.onConfirm}>
            Use this for my routes
          </button>
        </div>
      </section>
    </div>
  );
}

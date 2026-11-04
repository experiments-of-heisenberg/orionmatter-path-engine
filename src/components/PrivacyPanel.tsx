/**
 * PrivacyPanel.tsx: the Privacy tab.
 *
 * Top: the disclosure ladder, a bar for how many comparable engineers still match as you share role, level, goal and
 * region, with the crowd size k marked. It comes from code and loads at once. Below: an optional text check. The
 * person chooses whether Muse Spark reads their text or only code does, and is told what is sent where. Whatever is
 * found is shown with the exact quote, who found it, and a version of the text with each detail replaced by a placeholder.
 * The cohort is synthetic and the panel says so; it demonstrates the method and is not a guarantee.
 */
import { DEMO_BIO } from "../ui/demo";
import {
  MAX_STORY,
  K_OPTIONS,
  COMPANY_TYPES,
  RISK_WORD,
  findingGroups,
  kPosition,
  ladderRows,
  shareSummary,
  sourceWords,
  textCheckWords,
} from "../ui/privacy";
import type { PrivacyBindings } from "./usePrivacy";
import { h } from "../ui/display";

export function LadderChart({ rows, k }: { rows: ReturnType<typeof ladderRows>; k: number }) {
  const kx =
    rows.length > 0
      ? kPosition(
          rows.map((r) => ({
            added: r.added,
            label: r.label,
            shared: r.shared,
            size: r.size,
            passes: r.passes,
          })),
          k,
        )
      : 0;
  return (
    <ol className="ladder" aria-label="How the crowd shrinks as you share more">
      {rows.map((row) => (
        <li key={row.added} className="ladder__row">
          <div className="ladder__head">
            <span className="ladder__added">+ {row.added}</span>
            <span className="ladder__size">
              {row.size} {row.size === 1 ? "engineer" : "engineers"}
            </span>
            <span className={`tag ${row.passes ? "tag--ok" : "tag--amber"}`}>
              {row.passes ? `Crowd of ${k}+` : `Fewer than ${k}`}
            </span>
          </div>
          <div className="ladder__track" aria-hidden="true">
            <span
              className={`ladder__bar${row.passes ? "" : " ladder__bar--low"}`}
              style={{ width: `${Math.max(1.5, row.width * 100)}%` }}
            />
            <span className="ladder__k" style={{ left: `${kx * 100}%` }} />
          </div>
          <p className="ladder__sentence">{h(row.sentence)}</p>
        </li>
      ))}
    </ol>
  );
}

export function PrivacyPanel({ b }: { b: PrivacyBindings }) {
  const checking = b.textCheck.phase === "running";
  const done = b.textCheck.phase === "done" ? b.textCheck : undefined;
  const stale =
    done !== undefined &&
    (done.settings.k !== b.settings.k || done.settings.companyType !== b.settings.companyType);
  const ladder = b.ladder.phase === "done" ? b.ladder.result : undefined;
  return (
    <div className="privacy">
      <section className="panel" aria-labelledby="ladder-title">
        <h2 className="panel__title" id="ladder-title">
          What sharing reveals
        </h2>
        <p className="panel__lede">
          Each step adds one detail about you and counts how many comparable engineers in the cohort still
          match. The fewer who match, the easier it is to pick you out. The line marks the crowd size you want
          to stay inside.
        </p>
        <div className="privacy__settings">
          <div className="control">
            <label className="control__label" htmlFor="k-select">
              Stay in a crowd of at least
            </label>
            <select
              id="k-select"
              className="input input--select"
              value={b.settings.k}
              onChange={(e) => b.onK(Number(e.target.value))}
            >
              {K_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k} engineers
                </option>
              ))}
            </select>
          </div>
          <div className="control">
            <label className="control__label" htmlFor="company-select">
              A company type you might mention
            </label>
            <select
              id="company-select"
              className="input input--select"
              value={b.settings.companyType ?? ""}
              onChange={(e) => b.onCompanyType(e.target.value === "" ? undefined : e.target.value)}
            >
              <option value="">None</option>
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        {b.ladder.phase === "loading" && (
          <p className="panel__fine" role="status">
            {"Counting\u2026"}
          </p>
        )}
        {b.ladder.phase === "error" && (
          <div className="notice notice--error" role="alert">
            <p>{b.ladder.error}</p>
            <button type="button" className="button" onClick={b.onRetryLadder}>
              Try again
            </button>
          </div>
        )}
        {ladder && (
          <>
            <LadderChart rows={ladderRows(ladder.ladder)} k={ladder.k} />
            <p className="privacy__summary">{h(shareSummary(ladder))}</p>
            {ladder.notes.map((n) => (
              <p key={n} className="notice">
                {n}
              </p>
            ))}
            <p className="panel__fine">{h(ladder.basis)}</p>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="story-title">
        <h2 className="panel__title" id="story-title">
          Check something you plan to share
        </h2>
        <p className="panel__lede">
          Paste a bio, a post or a summary. Code looks for contact details, exact dates and exact pay. Muse
          Spark can also look for names, employers, schools and other details that point to you, and every
          detail it reports must quote your own words, which code then checks.
        </p>
        <div className="notice">
          <p>
            With <strong>Check with Muse Spark</strong>, your text is sent to the model with emails, phone
            numbers and links removed first. With <strong>Check with code only</strong>, it goes to this app
            {"\u2019"}s server but not to the model.
          </p>
        </div>
        <label className="control__label" htmlFor="story-input">
          Your text
        </label>
        <textarea
          id="story-input"
          className="input input--area"
          rows={5}
          value={b.draft}
          maxLength={MAX_STORY + 200}
          aria-invalid={b.draftProblem ? true : undefined}
          aria-describedby={b.draftProblem ? "story-problem" : undefined}
          onChange={(e) => b.onDraft(e.target.value)}
        />
        <p className="intake__example">
          <button
            type="button"
            className="button button--quiet"
            disabled={checking}
            onClick={() => b.onDraft(DEMO_BIO)}
          >
            Use an example
          </button>
        </p>
        <div className="chat__actions">
          <span className="chat__count" aria-hidden="true">
            {b.draft.length}/{MAX_STORY}
          </span>
          <span className="privacy__buttons">
            <button type="button" className="button" disabled={checking} onClick={() => b.onCheck(false)}>
              Check with code only
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={checking}
              onClick={() => b.onCheck(true)}
            >
              {checking ? "Checking\u2026" : "Check with Muse Spark"}
            </button>
          </span>
        </div>
        {b.draftProblem && (
          <p id="story-problem" className="turn__error" role="alert">
            {b.draftProblem}
          </p>
        )}
        {b.textCheck.phase === "error" && (
          <p className="turn__error" role="alert">
            {b.textCheck.error}
          </p>
        )}
        {done && (
          <div className="privacy__result" aria-live="polite">
            {stale && (
              <p className="notice" role="status">
                You changed the crowd size or company type since this check. Run it again to match.
              </p>
            )}
            <p className={`privacy__risk privacy__risk--${done.result.risk}`}>
              <span aria-hidden="true">{done.result.risk === "low" ? "\u2713" : "!"}</span>{" "}
              {RISK_WORD[done.result.risk]}
            </p>
            <ul className="privacy__reasons">
              {done.result.reasons.map((r) => (
                <li key={r}>{h(r)}</li>
              ))}
            </ul>
            <p className="panel__fine">{textCheckWords(done.result.textCheck)}</p>
            {findingGroups(done.result.findings).map((g) => (
              <div key={g.category} className="privacy__group">
                <h3 className="panel__sub">{g.title}</h3>
                <ul className="privacy__findings">
                  {g.items.map((f, i) => (
                    <li key={`${f.quote}-${i}`}>
                      <q>{f.quote}</q> <span className="privacy__why">{h(f.reason)}</span>{" "}
                      <span className="tag tag--gray">{sourceWords(f)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {done.result.generalisedText !== null && done.result.findings.length > 0 && (
              <>
                <h3 className="panel__sub">Your text with those details replaced</h3>
                <p className="privacy__preview">{done.result.generalisedText}</p>
              </>
            )}
            {done.result.notes.map((n) => (
              <p key={n} className="panel__fine">
                {n}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

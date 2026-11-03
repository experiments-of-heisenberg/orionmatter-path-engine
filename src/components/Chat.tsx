/**
 * Chat.tsx: the What-if conversation.
 *
 * One box. The person types a sentence ("what if I won't relocate and need B4 or higher?"), the
 * server understands it, code recomputes the routes, and the answer comes back as four plain things: what was
 * applied, what was refused or cannot be modelled (never silently dropped), a question when part of it was
 * too vague, and a short explanation whose every figure code has checked. The component owns only the text
 * being typed; the turns themselves live in the parent, so the whole thing renders to static HTML for tests.
 */
"use client";
import { useState } from "react";
import type { Turn } from "../ui/chat";
import { MAX_MESSAGE, checkMessage, pendingQuestion } from "../ui/chat";

/** Sentences to try, shown while the conversation is empty. */
export const EXAMPLES = [
  "What if I won\u2019t relocate?",
  "I need pay band B4 or higher",
  "What if I want to get there within 2 years?",
  "What if I learn Rust?",
] as const;

export interface ChatProps {
  turns: readonly Turn[];
  /** True while a turn is being answered. */
  busy: boolean;
  onSend: (text: string) => void;
}

/** One answered turn: what was understood, what was not, and the explanation. */
function Answer({ turn, onSend, last }: { turn: Turn; onSend: (text: string) => void; last: boolean }) {
  const result = turn.result;
  if (!result) return null;
  const { interpretation: reading, narration, diff } = result;
  const question = last ? pendingQuestion([turn]) : null;
  return (
    <div className="turn__answer">
      {reading.applied.length > 0 && (
        <div>
          <p className="turn__label">Applied</p>
          <ul className="applied" aria-label="Changes applied">
            {reading.applied.map((a) => (
              <li key={`${a.field}-${a.phrase}`} className="applied__item">
                <span className="applied__name">{a.label}</span>
                <span className="applied__change">
                  {a.from} <span aria-label="changed to">{"\u2192"}</span> {a.to}
                </span>
                <q className="applied__phrase">{a.phrase}</q>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reading.refused.length > 0 && (
        <div>
          <p className="turn__label">Not applied</p>
          <ul className="issues">
            {reading.refused.map((r) => (
              <li key={`${r.field}-${r.phrase}`}>
                <q>{r.phrase}</q>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reading.unsupported.length > 0 && (
        <div>
          <p className="turn__label">Cannot be modelled</p>
          <ul className="issues">
            {reading.unsupported.map((u) => (
              <li key={u.phrase}>
                <q>{u.phrase}</q>: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reading.conflicts.length > 0 && (
        <ul className="issues issues--warn" aria-label="Things to know">
          {reading.conflicts.map((c) => (
            <li key={c.message}>{c.message}</li>
          ))}
        </ul>
      )}
      {question && (
        <div className="question" role="group" aria-label="A question about your request">
          <p className="question__text">{question.question}</p>
          {question.options.length > 0 && (
            <div className="choices">
              {question.options.map((option) => (
                <button key={option} type="button" className="choice" onClick={() => onSend(option)}>
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {reading.status === "nothing_applicable" && reading.unsupported.length === 0 && !question && (
        <p className="turn__plain">
          Nothing in that could be turned into a change to your limits. Try something like {"\u201c"}what if I
          won{"\u2019"}t relocate?{"\u201d"}
        </p>
      )}
      {diff.facts.length > 0 && (
        <div className="narration">
          <p className="narration__headline">{narration.headline}</p>
          <ul className="narration__points">
            {narration.points.map((p) => (
              <li key={p.text}>{p.text}</li>
            ))}
          </ul>
          <p className="narration__source">
            {narration.source === "model"
              ? "Phrased by Muse Spark. Code checked every figure against the cohort."
              : "Written directly from the computed facts."}
          </p>
          <details className="narration__facts">
            <summary>The facts behind this</summary>
            <ul>
              {diff.facts.map((f) => (
                <li key={f.id}>
                  {f.text}
                  {f.thin ? " Limited evidence." : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {diff.facts.length === 0 && reading.applied.length > 0 && (
        <p className="turn__plain">That change does not move any route enough to report.</p>
      )}
    </div>
  );
}

export function Chat({ turns, busy, onSend }: ChatProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const submit = (): void => {
    const checked = checkMessage(draft);
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(undefined);
    setDraft("");
    onSend(checked.text);
  };
  const open = pendingQuestion(turns);
  return (
    <section className="panel chat" aria-labelledby="chat-title">
      <h2 className="panel__title" id="chat-title">
        Ask what if
      </h2>
      <p className="panel__lede">
        Say it in your own words. Muse Spark understands the sentence; the routes and every number are
        recomputed by code from the cohort.
      </p>

      {turns.length === 0 && (
        <ul className="examples" aria-label="Examples to try">
          {EXAMPLES.map((e) => (
            <li key={e}>
              <button
                type="button"
                className="choice"
                disabled={busy}
                onClick={() => onSend(e.replace(/[\u2019]/g, "'"))}
              >
                {e}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ol className="turns" aria-label="Conversation" aria-live="polite">
        {turns.map((turn, index) => (
          <li key={turn.id} className="turn">
            <p className="turn__you">
              <span className="sr-only">You asked: </span>
              {turn.message}
            </p>
            {turn.status === "working" && (
              <p className="turn__working" role="status">
                {turn.stage}
              </p>
            )}
            {turn.status === "error" && (
              <p className="turn__error" role="alert">
                {turn.error}
              </p>
            )}
            {turn.status === "done" && (
              <Answer turn={turn} onSend={onSend} last={index === turns.length - 1} />
            )}
          </li>
        ))}
      </ol>

      <form
        className="chat__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          {open ? open.question : "What would you like to change?"}
        </label>
        <textarea
          id="chat-input"
          className="input input--area"
          rows={2}
          value={draft}
          maxLength={MAX_MESSAGE + 100}
          placeholder={open ? "Type your answer\u2026" : "What if I\u2026"}
          aria-describedby={problem ? "chat-problem" : undefined}
          aria-invalid={problem ? true : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!busy) submit();
            }
          }}
        />
        <div className="chat__actions">
          <span className="chat__count" aria-hidden="true">
            {draft.length}/{MAX_MESSAGE}
          </span>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Working\u2026" : "Ask"}
          </button>
        </div>
        {problem && (
          <p id="chat-problem" className="turn__error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </section>
  );
}

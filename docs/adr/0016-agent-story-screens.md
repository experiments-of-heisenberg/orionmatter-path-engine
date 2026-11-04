# ADR 0016: Show how the plan was made, and let privacy decide what leaves the screen

- Status: accepted
- Date: 2026-11-04

## Context

A career plan from a model is only worth trusting if a person can see how it was made, what was checked, and what
was not. The same person is being asked to hand over details about themselves (a story, a screenshot) and may want to
share the result. Four screens carry that: the Plan tab with its Agent Trace, the Privacy tab, the Your story tab and
the Share tab. Each one is a place where a screen can quietly say more than the data supports, or reveal more than the person meant.

## Decision

1. **The trace is the stream, nothing more.** The Agent Trace is built by a pure reducer over exactly the events the
   run streamed. It shows which lookups Muse Spark chose, which ones code had to fill in (and says so), and every
   objection the Skeptic raised with the exact words it objected to. Nothing is staged, summarised away or invented.
   It is capped at 200 items and says when it was cut.
2. **An unresolved plan is shown as unresolved.** The headline says how many objections remain, the objections are
   listed, the warning style is used, and the plan's steps are never drawn on the map. Only an approved plan made for the
   limits the person has now puts numbered steps on the map; change a limit and the plan is marked as made for earlier limits.
3. **Privacy decides what is shared.** The trail card shows only the personal details the disclosure ladder says keep the
   person in a crowd of at least k. Details beyond the last passing step are listed as withheld, never silently dropped, and
   details the ladder does not count (years of experience, technologies, anything typed) are never shown. The card is drawn
   and saved in the browser. If the privacy count cannot be loaded, no card is offered.
4. **Say exactly what is sent where.** The text check offers two buttons, one where Muse Spark reads the text (with
   contact details removed first) and one where only code does, and states plainly that code-only text still reaches this app's
   server. A screenshot warning says that a picture goes to the model as it is and cannot be redacted.
5. **Intake is a form, not a fact.** The reading fills an editable form with where each field came from (the person's own
   quoted words, a screenshot to be checked, a mapping, or their own hand). Anything the model proposed and code refused is listed with the
   reason. Every required field can be filled by hand. Corrections are sent back with an answer to a question, so they are never lost.
6. **A confirmed person rebuilds the session.** Confirming changes a React key, so the whole session (scenarios, plan, chat,
   privacy draft) is created fresh for that person. It is the simplest way to be certain nothing from the sample can leak across.
7. **The browser downloads no server code.** Constants the browser needs live in a file with no imports (`limits.ts`); a test
   bundles the app for the browser and fails if the request-checking library, a Node module or the cohort data gets in.
   (One shared constant had pulled in zod and made the app five times larger.)

## Consequences

- Positive: a judge or a user can read the whole story of a plan, including its failures; what leaves the screen is bounded by a number the person chose.
- Negative: a plan and its trace are not saved across reloads; rebuilding the session drops unsaved scenarios when someone confirms their story.
- Testing: static-render tests for every wording rule, simulated-browser tests for the three network hooks and the rebuild, hook-level tests for guards a button hides, a browser-bundle test, and fifteen mutations checked (one survived at first and led to a hook-level test).

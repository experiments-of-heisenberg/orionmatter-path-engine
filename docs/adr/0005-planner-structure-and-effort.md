# ADR 0005: Planner structure and reasoning-effort defaults

- Status: accepted
- Date: 2026-11-03

## Context

The Planner must produce three evidence-backed routes. Two risks: a model inventing numbers,
and a live demo that takes minutes. Early live runs with medium reasoning took up to 174 s
(the composition call alone 157 s) because Muse Spark's hidden reasoning dominated.

## Decision

1. **Models write words, code owns every number.** The model drafts summaries and steps
   (`PlanDraft`, which has no metric fields). Code computes metrics, radar and evidence
   links from tool results and merges them (`assemblePlan`). A model cannot alter a figure.
2. **Agentic gathering with code completion.** The model chooses tool calls, which makes its
   behaviour visible in the trace. Code then guarantees the evidence is complete and runs
   anything the model skipped. Evidence is reused only if its arguments match exactly, so an
   exploratory variant never leaks into the plan.
3. **Shape the tools for the model.** `findTwins` takes no profile (the executor injects the
   real one); `pathStats` takes an evidence id instead of a list of ids. This removes whole
   classes of copy errors and makes impersonating another profile impossible.
4. **Default reasoning: gather `low`, compose `minimal`.** Measured live: compose took 157 s at
   medium, 47 s at low (and once returned unparseable output), and 13 s at minimal with the
   same claim accuracy. See docs/api-notes.md.
5. **The fast path and agent path share `gatherEvidence`.** What-if sliders (Part 6 onwards)
   can recompute the numbers in milliseconds with no model, using the same function.

## Consequences

- Positive: a plan takes about 20 to 40 s end to end and its numbers are traceable.
- Positive: What-if can redraw instantly because the numbers never needed a model.
- Negative: minimal reasoning gives plainer prose, and about one run in four needed a repair
  call. Acceptable for a demo; revisit if quality complaints appear.
- Negative: claims, month windows and overclaiming language are only requested in the
  prompt until the Skeptic (Part 5) verifies them.

# ADR 0007: The What-if interpreter

- Status: accepted
- Date: 2026-11-03

## Context

What-if is the feature people will remember: type a sentence, watch the map redraw. A model can
read the sentence, but letting it write constraints directly would let a misreading, a
hallucination or a prompt injection change the plan. The cohort also cannot represent many
things people ask for (a 4-day week, no on-call, visa sponsorship).

## Decision

1. **Models propose; code validates and applies.** The model returns proposed changes, each with
   the words it is based on. Code range-checks every value, normalises skills (one or two short
   words), and builds the new constraints. The model never writes constraints.
2. **A quote guard.** A change is discarded unless its quoted words appear, as whole words, in
   what the person wrote or in their own earlier answers. Quotes from the assistant's own
   question never count. This stops invented requests, including a quote of "go" inside "goal".
3. **Unsupported is reported, never remapped.** Requests the data cannot represent are listed with
   a reason. Silently mapping "no on-call" onto some other field would be worse than refusing.
4. **Clear parts apply immediately; vague parts become a question.** The map can redraw while the
   interface asks about "more money". Nothing is guessed.
5. **Contradictions are detected by code too.** Opposite values for one field, or adding and
   removing the same skill, are caught in code. Neither side is applied, and a question is built
   if the model did not ask one.
6. **Evidence conflicts are reported, never enforced.** After applying, the engine's fast path is
   recomputed and conflicts reported with numbers (no timeline fits, pay floor unreachable, thin
   cohort, nobody reached the goal). The person decides.
7. **Evaluate on real sentences.** 28 labeled cases with an offline-tested matcher, run live.

## Consequences

- Positive: a model misreading cannot produce an invalid or unsafe constraint; every refusal has
  a reason a person can read; the live evaluation passed 84 of 84 runs at a median of about 2 s.
- Negative: whole-word quote matching can reject a legitimate quote with different punctuation
  than the message. The evaluation showed no recall loss, but it should be re-measured if the
  prompt changes.
- Negative: only six knobs exist, and of those only remote and noRelocation currently change the
  numbers the engine computes. Part 7 makes the others move real evidence.

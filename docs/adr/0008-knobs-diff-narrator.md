# ADR 0008: Real knobs, a diff of facts, and a narrator that cannot invent

- Status: accepted
- Date: 2026-11-03

## Context

After Part 6 only two of the six What-if knobs changed any number. A slider that moves nothing
is decoration, and a judge will notice. We also want the interface to say, in words, what a
change did, and words are where a model is most tempted to invent a figure or a cause.

## Decision

1. **"Reached" means reached within the person's limits.** A time limit and a pay floor are
   applied inside `pathStats`: a twin counts only if they reached the goal within `maxMonths` and
   at or above `minCompBand`. Twins who reached the goal but outside the limits are reported in
   their own share (`outsideLimits`), not as failures, because they did reach it. The cohort's
   unconstrained figures stay in the result (`ignoringLimits`) so every message can say what
   would be true without the limits.
2. **Risk tolerance changes the order, not the data.** It picks which end of each route's success
   interval ranks the routes (low end, middle, high end). A route with little evidence has a wide
   interval, so a cautious person is steered to well-evidenced routes and a bold one to upside.
   A route is only recommended if someone reached the goal on it within the limits.
3. **Skills are association, never cause.** `skillStats` compares twins who proved a skill with
   those who did not, with sizes and intervals. `distinguishable` is true only when the intervals
   do not overlap. A skill the cohort never recorded says so. We did not tune the synthetic data
   to make skills look useful: in this cohort the honest answer is "we cannot tell".
4. **A diff of facts, written by code.** Each fact is one sentence with its numbers listed and
   its evidence ids. A change in a success range is called real only when the ranges stop
   overlapping; otherwise the fact says it may be noise.
5. **The narrator chooses and phrases, and code checks.** The model picks and orders facts. Code
   rejects: a number not in the facts the point cites; promise words; a skill described as a
   cause; crediting the person with a cohort outcome ("you reached"); a thin fact without the words
   "limited evidence"; and any headline change (a route appearing or disappearing, a changed
   recommendation) that no point covers. One repair attempt follows, then a template built
   straight from the facts, which is valid by construction. The explanation is therefore
   never missing and never unverified.
6. **Two paths.** The deterministic fast path (no model) recomputes the plan so the map can redraw
   at once; the explanation follows. The full Planner + Skeptic run is separate and slower.

## Consequences

- Positive: every knob does something real and explainable; the narrator's output is checked by
  code, and a rejection is a plain-language reason a model can fix. Live, 21 of 21 narrations
  passed on the first attempt.
- Negative: time and pay limits shrink the sample, so intervals widen and many routes will show
  limited evidence; that is honest, and the interface says so.
- Negative: a full What-if turn is slower than the interpreter alone (median about 9 s live),
  mostly the narrator. The map does not wait for it.
- Negative: skills carry no visible effect in the sample data, so that part of the demo shows an
  honest "cannot tell" instead of a win. We accept that.

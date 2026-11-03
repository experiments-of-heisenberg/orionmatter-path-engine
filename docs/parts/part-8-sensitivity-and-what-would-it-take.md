# Part 8: Sensitivity tornado and "what would it take?"

**Goal:** after a What-if change, answer "which of my constraints costs me the most?" and
"what is the smallest thing I could change?" straight from the evidence, with no model involved.

## The problem

A person sets a time limit or a pay floor and the plan gets worse, or they have no good route
at all. They ask two things: "which of my constraints is costing me the most?" and "I have no
good route; what is the smallest thing I could change?". Both can be answered from the
evidence without a model: recompute the headline numbers under nearby constraints and report
what moves.

## The headline metric

Both answers are measured with one shared metric (`src/lib/whatif/metric.ts`): the recommended
route's success range with the number of engineers behind it. For the sample engineer (backend,
L5 to Staff, IN-south, no constraints) that is the climb route, 74-92%, with 47 comparable
engineers who reached the goal (55 on the route, 150 twins in total).

It is a range with a sample size because a single number would hide how much the evidence can
actually say: the range is the 95% interval for the share who reached the goal, and the sample
size tells thin evidence from strong evidence. When no route has anyone who reached the goal
within the person's limits, there is no recommended route and the metric says so (`route` is
null, the range is [0, 0]) instead of inventing a zero.

## The tornado

The tornado (`src/lib/whatif/sensitivity.ts`) measures, for each knob in turn, how far the
headline metric moves when that one knob varies and everything else stays at the person's
current settings. The knob whose alternatives spread the metric most goes on top: the widest
bar of the tornado.

It covers four knobs, trying these values for each:

| Knob             | Values tried                                                             |
| ---------------- | ------------------------------------------------------------------------ |
| Remote only      | off, on                                                                  |
| No relocation    | off, on                                                                  |
| Time limit       | 12, 18, 24, 36, 48, 60 months, plus the person's own limit, and no limit |
| Minimum pay band | no floor, B3, B4, B5 (plus your own floor if it is B1 or B2)             |

Each bar's swing is the distance between its best and worst option, in whole percentage points
of the middle of the success range (best minus worst, rounded). The worst option is the one
with the lowest success and the best the one with the highest (ties go to the first listed).
Bars are ordered widest swing first; ties keep the order remote, noRelocation, maxMonths,
minCompBand.

`riskTolerance` and `addSkills` are deliberately not bars, and the reason is precise:
`riskTolerance` reorders the routes without changing any success rate, and `addSkills` is a
with-versus-without comparison that changes no headline rate either. A bar of zero width would
suggest they do nothing, when in fact they change something a success rate cannot show.

For the sample engineer the tornado looks like this (computed by running the code, pinned in
`tests/sensitivity.test.ts`):

| Knob             | Swing (percentage points) |
| ---------------- | ------------------------- |
| Time limit       | 83                        |
| Minimum pay band | 30                        |
| Remote only      | 1                         |
| No relocation    | 1                         |

The time limit dominates: at 12 months nobody reached the goal on any route, while at 48
months the headline is back up at 74-92%.

## "What would it take?"

When the current constraints reach the target there is nothing to relax. Otherwise the search
(`src/lib/whatif/wouldItTake.ts`) finds, for each constraint the person has set, the smallest
relaxation of that one constraint that reaches the target. The default target is 10 comparable
engineers who reached the goal within the limits, with a success range centred on at least 50%;
it is configurable through the `Target` argument.

Each knob is searched in its own direction, stopping at the first value that works so the
answer is minimal: the time limit is raised one month at a time up to the supported maximum of
120 months; the pay floor is lowered one band at a time (B5 to B4 to B3 and so on) and then
removed; remote-only and no-relocation are each simply turned off.

Only one knob changes at a time so each answer is a clean, honest "if you changed just this".
If no single change is enough, the answer says so in a plain sentence rather than guessing at
combinations. Options come back ordered by the success they give, best first, each with its
numbers and a sentence written by code, for example:

> Raise your time limit from 12 months to 23 months: the jump route would then have 34
> comparable engineers who reached the goal within your limits, a 40-64% success range.

Worked examples with real numbers, verified by running the code:

- From a 12-month limit (default target), the smallest working limit is 23 months: the jump
  route, 34 engineers, 40-64%. The month below it, 22, does not reach the target.
- From a B5 floor with a stricter target (40 engineers, 60% centre), lowering to B4 works:
  the climb route, 41 engineers, 62-84%.

## A short note on honesty

These are comparisons within a synthetic cohort, not predictions about the person. A relaxation
is not a promise: it says that comparable engineers with looser limits did better, not that
the person will. Success ranges can overlap, in which case the difference may be noise. When
the evidence behind an option is thin, the sentence says "(limited evidence)" itself.

## Files

| File                                                            | What it does in one line                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/whatif/metric.ts` (new)                                | The headline metric both answers are measured with.                |
| `src/lib/whatif/sensitivity.ts` (new)                           | The tornado: per-knob spread of the headline metric.               |
| `src/lib/whatif/wouldItTake.ts` (new)                           | The single-knob relaxation search with code-written sentences.     |
| `src/lib/whatif/index.ts` (changed)                             | Re-exports the new modules.                                        |
| `tests/sensitivity.test.ts` (new)                               | Pins the sample-engineer numbers for both features.                |
| `tests/tornadoEdges.test.ts` (new)                              | Tornado edges: more people, zero twins, month edges, risk, purity. |
| `tests/wouldItTakeEdges.test.ts` (new)                          | Relaxation edges: grids, minimality, B1, 120 months, zero target.  |
| `docs/parts/part-8-sensitivity-and-what-would-it-take.md` (new) | This guide.                                                        |

## Live evaluation

This part is deterministic and uses no model, so there is no live evaluation; its numbers are pinned by tests.

## Known limits

- Single-knob relaxations only: combinations ("a little more time and a little less pay") are
  never suggested, even when each alone fails.
- The tornado tries fixed values, so it can miss the exact tipping point: it tries 18 then 24
  months, while the search finds that 23 is already enough. The tornado shows where to look;
  the search finds the minimum.
- Skills and risk tolerance are not covered: they move no success rate, so neither the tornado
  nor the search speaks to them.
- A relaxation can be large. For a platform engineer in IN-south with a B5 floor and a
  24-month limit (default 10-engineer target), the time-limit option is to raise the limit
  from 24 all the way to 54 months: the pivot route, 15 engineers, a 33-67% success range.
  (Lowering the floor to B4 also works there and is the smaller change.)

## How to verify

```bash
npm run check
```

## What review found

Muse Code's bug hunt found one real bug, now fixed with a regression test: a pay floor of B1 or B2 is a
valid constraint, but the pay-floor bar only tried B3 to B5, so none of its options was marked as the
current one. The bar now always includes the person's own floor.

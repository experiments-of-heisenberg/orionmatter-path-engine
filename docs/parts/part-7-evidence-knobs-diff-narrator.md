# Part 7: Evidence knobs, the diff engine and the narrator

**Goal:** make every What-if knob move a real number, and explain each change in
words that cannot invent facts.

## The problem

In Part 6 only two of six knobs changed any number. `remote` and `noRelocation`
changed who counted as a comparable engineer, but `maxMonths`, `minCompBand`,
`riskTolerance` and `addSkills` were recorded and checked for conflicts without
moving any route figure. A slider that moves nothing is decoration.

Part 7 makes every knob do something real, and explains each change in words
that cannot invent facts. The numbers come from deterministic tools over the
synthetic cohort; the sentences come from code that lists its numbers; a model
only picks and phrases, and code checks everything it writes.

## The six knobs

| Knob            | What it does to the evidence                                                                                                    | Where in the code                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `remote`        | Changes who counts as a comparable engineer: only remote twins are kept.                                                        | `src/lib/tools/findTwins.ts`                                                         |
| `noRelocation`  | Changes who counts: only twins in your region (or remote twins) are kept.                                                       | `src/lib/tools/findTwins.ts`                                                         |
| `maxMonths`     | Changes what counts as having reached the goal: only twins who reached it within that many months (within the person's limits). | `src/lib/tools/pathStats.ts`, limits built in `src/lib/engine/facts.ts` (`limitsOf`) |
| `minCompBand`   | Changes what counts as having reached the goal: only twins who ended at or above that pay band (within the person's limits).    | `src/lib/tools/pathStats.ts`, limits built in `src/lib/engine/facts.ts` (`limitsOf`) |
| `riskTolerance` | Changes the order routes are suggested in by choosing which end of the success interval ranks them (low end, middle, high end). | `src/lib/engine/rank.ts`                                                             |
| `addSkills`     | Adds a with-versus-without comparison per route; does not change the headline numbers.                                          | `src/lib/tools/skillStats.ts`, wired per route in `src/lib/engine/facts.ts`          |

To be exact: `remote` and `noRelocation` change who counts as a comparable
engineer; `maxMonths` and `minCompBand` change what counts as having reached
the goal (within the person's limits); `riskTolerance` changes the order routes
are suggested in by choosing which end of the success interval ranks them;
`addSkills` adds a with-versus-without comparison per route and does not change
the headline numbers.

## Worked example

The sample engineer is backend, L5 to Staff (L6), in IN-south. They have 150
comparable engineers: 55 on climb, 65 on jump, 30 on pivot. These numbers were
computed by running the code (see `tests/limitsAndRanking.test.ts` and
`tests/whatifDiff.test.ts` for the same figures).

With no limits the climb route is 74-92% over 55 comparable engineers. (Jump is
56-78% over 65; pivot is 46-78% over 30.)

With a 24-month limit the climb and pivot routes have nobody who reached the
goal in time and jump remains: climb drops to 0 of 55 within 24 months, pivot
to 0 of 30, while jump keeps 36 of 65 (43-67%). The recommendation moves from
climb to jump, because a route is only recommended when someone reached the
goal on it within the limits.

## Reached within your limits

"Reached" means reached within the person's limits. Each route reports four
outcome shares that add to 1 (before rounding), plus the unconstrained figure
for context:

| Share                         | Meaning                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `reached`                     | Reached the goal within the limits (this is the only share the success range counts). |
| `outsideLimits`               | Reached the goal, but outside the limits (too late, or below the pay floor).          |
| `stalled`                     | Stalled and never reached the goal.                                                   |
| `leftField`                   | Left the field or role.                                                               |
| `ignoringLimits.reachedShare` | Context: the share who reached the goal when the limits are ignored.                  |

People who reached the goal late are reported separately and not as failures
because they did reach it. Calling a 30-month Staff promotion a failure when
the person asked for 24 months would lie about the route; saying "47 of 55
reached it, but none within 24 months" tells the truth and names the gap. The
fastest time and highest band without limits are kept alongside, so every
message can say what would be true without the limits.

## Skills: association, not cause

`skillStats` compares twins on one route who proved a skill with those who did
not. Both groups carry a sample size and a 95% interval. This is association,
never cause: people who prove a skill may differ in other ways, so the text
says "associated with", never "boosts" or "causes".

The `distinguishable` flag is true only when the two success ranges do not
overlap. Overlap means the difference could be noise, and the interface says
"we cannot tell a difference".

A skill the cohort never recorded returns `known: false`: there is simply no
evidence, and the text says the cohort has no evidence about it. Matching is
exact after lower-casing (spaces become hyphens); there is no fuzzy matching,
because a wrong match would attach real numbers to the wrong skill. The
everyday aliases are:

| What you type                                                            | Cohort skill        |
| ------------------------------------------------------------------------ | ------------------- |
| k8s                                                                      | kubernetes          |
| mlops, ml ops                                                            | ml-ops              |
| system design, systems design                                            | system-design       |
| distributed systems                                                      | distributed-systems |
| cross team lead, cross-team leadership, cross team leadership, tech lead | cross-team-lead     |

The cohort records six skills: cross-team-lead, distributed-systems, kubernetes,
ml-ops, rust, system-design. In this synthetic cohort no skill separates the
groups, so the honest answer is "we cannot tell".

## Risk tolerance

Risk tolerance changes the order, not the data. It picks which point of each
route's success interval ranks the routes:

| Tolerance | Ranks by                                                           |
| --------- | ------------------------------------------------------------------ |
| low       | The cautious (low) end: steady, well-evidenced routes first.       |
| medium    | The middle of the interval.                                        |
| high      | The optimistic (high) end: upside first, even on thinner evidence. |

Ties go to the faster route, then to the fixed order climb, jump, pivot. A
route nobody reached the goal on (within the limits) always sorts last.

Illustration (made-up numbers, not cohort data): route A has a success range of
30-95% (wide: little evidence) and route B has 60-70% (narrow: solid
evidence). At low tolerance B wins (60 beats 30); at high tolerance A wins (95
beats 70); at medium B wins (65 beats 62.5).

## The diff engine

When a constraint changes, `diffSheets` compares the before and after fact
sheets and returns facts: sentences written by code with their numbers listed.
Each fact carries an id (`f1`, `f2`, ...), the numbers its text uses, the
ledger evidence ids it rests on, a `thin` flag, and a `mustMention` flag. The
model never sees raw numbers to restate; it picks and orders facts.

A fact is written only when the change is big enough to say out loud:

| Threshold                  | Value                                      |
| -------------------------- | ------------------------------------------ |
| Success-range middle moves | 5 percentage points (`RATE_SHIFT_MIN`)     |
| Timeline middle moves      | 3 months (`MONTHS_SHIFT_MIN`)              |
| Reached outside the limits | 10 percent of twins (`OUTSIDE_LIMITS_MIN`) |

A change in a success range is called a "real change" only when the old and new
intervals no longer overlap; otherwise the fact says it "may be noise". Skill
facts say "associated with", never "causes", and facts on thin evidence say
"(limited evidence)" in their text.

The `mustMention` rule: facts that carry a headline change (a route appearing
or disappearing, the recommendation changing, a separated success range) must
be covered by the narration, so the most important thing that moved cannot be
hidden.

## The narrator

The pipeline in `src/lib/whatif/narrate.ts`:

```text
FACTS        code-written sentences with ids (from diffSheets)
  │
  ▼
MODEL        picks which facts matter, orders them, phrases them for the person
  │
  ▼
VERIFY       verifyNarration checks every number and word against the cited facts
  │
  ▼
REPAIR       one retry with the rejection reasons, if the first attempt failed
  │
  ▼
TEMPLATE     fallback built straight from the facts, valid by construction
```

`verifyNarration` makes these checks (a rejection is a plain sentence a model
can fix):

| Check                 | What it rejects                                                                   |
| --------------------- | --------------------------------------------------------------------------------- |
| Unknown fact id       | A point citing an id that is not a fact.                                          |
| Ungrounded number     | A number in a point that is not in the facts that point cites.                    |
| Promise words         | "will", "guarantee", "certain", "always", "never", "definitely" and kin.          |
| Personal outcome      | "you reached" and kin: the numbers describe comparable engineers, not the person. |
| Causal skill          | A skill described as boosting, raising, improving or causing anything.            |
| Thin evidence         | A point on thin evidence that does not say "limited evidence".                    |
| Headline numbers      | A headline number no cited fact supports.                                         |
| Headline promises     | A promise word in the headline.                                                   |
| Must-mention coverage | A headline change no point covers.                                                |

The template fallback is a floor, not a failure. It repeats fact text directly,
ordered with headline changes first, so it is valid by construction. When the
model cannot be verified after one repair, the person still gets an
explanation: never missing, never unverified.

## Files

| File                                     | What it does in one line                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `src/lib/tools/skillStats.ts` (new)      | With-versus-without comparison for one skill on one route, with intervals. |
| `src/lib/engine/rank.ts` (new)           | Orders routes by the interval end the risk tolerance cares about.          |
| `src/lib/whatif/diff.ts` (new)           | Compares two fact sheets into code-written facts with listed numbers.      |
| `src/lib/whatif/narrate.ts` (new)        | Model picks and phrases facts; code verifies, repairs once, or falls back. |
| `src/lib/whatif/run.ts` (new)            | One What-if turn: interpret, recompute before/after, diff, explain.        |
| `src/lib/tools/pathStats.ts` (changed)   | "Reached" now means reached within the person's time and pay limits.       |
| `src/lib/tools/stats.ts` (changed)       | Shared Wilson interval and band helpers.                                   |
| `src/lib/tools/toolSchemas.ts` (changed) | Validated `LimitsSchema` for time and pay limits.                          |
| `src/lib/tools/ledger.ts` (changed)      | Records skillStats calls alongside the other tools.                        |
| `src/lib/engine/facts.ts` (changed)      | Gathers per-route stats, skills and ranking under the person's limits.     |
| `src/lib/engine/summaries.ts` (changed)  | One-line trace summaries, including skillStats results.                    |
| `src/lib/skeptic/verifier.ts` (changed)  | Sample-size rule extended to skillStats evidence.                          |
| `src/lib/whatif/conflicts.ts` (changed)  | Infeasible and thin-evidence checks against the limited fact sheet.        |
| `scripts/live-whatif-run.ts` (new)       | Live script: full What-if turns on the real model, reporting the narrator. |

The core tests are `tests/limitsAndRanking.test.ts`, `tests/whatifDiff.test.ts`
and `tests/whatifNarrate.test.ts`. This page ships with five edge-test files:
`tests/wilson.test.ts`, `tests/toolLimits.test.ts`, `tests/skillStatsEdges.test.ts`,
`tests/diffEdges.test.ts` and `tests/rankEdges.test.ts`.

## Live evaluation

Measured on 3 Nov 2026 against the real model (`npm run live:whatif-run`): seven complete
What-if turns (time limit, pay floor, skills, remote, a time limit plus risk tolerance, a limit
nobody can meet, and removing a limit), each run three times (21 turns).

| Measure                                                             | Result                  |
| ------------------------------------------------------------------- | ----------------------- |
| Final narration passed every check (`source: "model"`)              | 21 of 21                |
| Fell back to the template                                           | 0 of 21                 |
| First attempt rejected, then fixed by the single retry              | 5 of 21                 |
| Full turn (interpret, recompute, diff, narrate): median / p90 / max | 9.6 s / 15.4 s / 18.9 s |

The 5 rejections are the point of the design: before the verifier learned to catch "you reached"
(a cohort outcome credited to the person), the first live run showed exactly that wording in
accepted narrations. The map does not wait for the narrator, so the slow part is not on the
redraw path.

What review and testing found along the way, all fixed:

- **A wording slip found in live output:** "you reached B5 before" attributed a cohort outcome to the
  person. It is now a code check, with a prompt rule and a mutation-checked test.
- **Three bugs from Muse Code's bug hunt:** a thin pay-band fact that did not say "limited
  evidence"; a route with no timeline that did not lose a tie; `wilsonInterval` returning NaN or a
  negative interval for invalid input.
- **A semantic bug from its doubts:** under a time limit the survivorship caveat counted people who
  reached the goal late as "stalled or left the field". It now counts only people who never reached
  it.
- **Boundary validation:** `Constraints` now rejects a time limit that is not a whole number of
  months from 1 to 240, and a pay band that is not B1 to B5.

## Known limits

- Skills are limited to the six the cohort records; anything else has no evidence.
- Time and pay limits shrink the sample, so intervals get wide and many routes show limited evidence.
- The narrator is a model and its wording can be stiff even when valid.
- English only.

## How to verify

```bash
npm run check
```

Unit tests use the scripted mock model. One live script runs full What-if turns
on the real model and reports the narrator:

```bash
npm run live:whatif-run   # with MODEL_API_KEY and BASETEN_API_KEY exported; see .env.example
```

It reports how often the narration came from the model versus the template, how
often the first attempt was rejected, the narrations themselves, and latency.

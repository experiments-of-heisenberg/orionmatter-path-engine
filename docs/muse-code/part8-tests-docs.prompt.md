# Task: extra tests, a bug hunt and a docs page for Part 8 (tests and docs only)

Read AGENTS.md first and follow it. Part 8 added a sensitivity "tornado" and a "what would it take" search.
The code is implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION.
You must NOT change any file under src/, evals/ or scripts/.

## Read first (do not edit)
src/lib/whatif/metric.ts, sensitivity.ts, wouldItTake.ts, src/lib/engine/facts.ts, rank.ts,
src/lib/tools/pathStats.ts, and the existing tests/sensitivity.test.ts and tests/limitsAndRanking.test.ts and
tests/helpers/fixturesData.ts. Do NOT duplicate what those already test; add what is missing.

## Create these test files (Vitest, deterministic, offline, no live API)

1. tests/tornadoEdges.test.ts
   - Several different people: use a few role families and regions available in the cohort (see COHORT in
     src/lib/tools/data.ts and Profile in src/lib/schemas.ts). For each: sensitivityTornado returns four bars, every bar has
     exactly one current option equal to the baseline, swing is a whole number from 0 to 100, worst <= best, and bars are
     sorted by swing with ties in the order remote, noRelocation, maxMonths, minCompBand.
   - A person with a very thin cohort (an unusual role or goal where findTwins returns few or zero twins): the tornado does not
     throw, the baseline route is null when there is no evidence, and every swing is 0. Find such an input from the real data
     (for example a goal level nobody reached, like EM2, or a role family with few twins) and state how you found it.
   - A person whose current maxMonths is at the supported edges (6 and 120) and whose limit coincides with one of MONTH_OPTIONS
     (e.g. 24): no duplicate option labels, the list is sorted ascending with "no limit" last.
   - riskTolerance does not add a bar, but it can change which route is recommended and therefore the baseline: assert that the
     baseline.route under "low", "medium" and "high" is always one of climb, jump, pivot or null (no crash) for several inputs.
   - Does not mutate its input (deep-compare before and after) and does not leak evidence between calls (two calls give equal results).

2. tests/wouldItTakeEdges.test.ts
   - alreadyMet is true exactly when meetsTarget(current, target) is true, over a grid of constraints and targets you choose.
   - Relaxing a knob that is NOT set is never offered (for every combination of set/unset knobs, options only contain set knobs).
   - minimality: for every returned option, one step less relaxation (for maxMonths: months - 1, for minCompBand: the next
     stricter band, for booleans: not applicable) does NOT meet the target, over a grid of inputs. This is the key property:
     write it as a loop over many inputs.
   - maxMonths at the supported maximum (120) has nothing to raise: no maxMonths option and no throw.
   - a pay floor of B1: lowering it is possible only to "no floor"; check the behaviour and state it (read the code).
   - a target with minReached 0 and minRate 0: any person with at least one route that has reachedN >= 0 and a route is
     alreadyMet; check what happens when no route exists (route null): meetsTarget must be false. State what you find.
   - options never contain a relaxation whose metric.route is null.
   - the text of each option begins with the expected phrase per knob and ends with a full stop, and contains "(limited evidence)"
     exactly when metric.thin is true.

## Create docs/parts/part-8-sensitivity-and-what-would-it-take.md
Plain-language guide for someone new to the project. Include:
- The problem: after a What-if change a person asks two things: "which of my constraints is costing me the most?" and "I have no good
  route; what is the smallest thing I could change?". Both can be answered from the evidence without a model.
- The headline metric: the recommended route's success range with the number of engineers behind it (read metric.ts); why it is a
  range with a sample size; what happens when there is no route.
- The tornado: what it measures, the four knobs it covers, the values tried for each (read sensitivity.ts), how swing is computed,
  the ordering and tie rule, and why riskTolerance and addSkills are deliberately NOT bars (state the reason precisely).
  Include a table with the REAL numbers for the sample engineer (backend, L5 to Staff, IN-south, no constraints): the swing of each knob.
  Compute them by running the code in a throwaway test or script of your own before writing them down: expect time limit 83, pay floor 30,
  remote 1, no relocation 1; verify and correct if different.
- "What would it take": the target (10 engineers, 50% centre, configurable), the search for each knob, why only one knob changes at a time,
  and what the answer looks like. Worked examples with real numbers, verified by running: from a 12-month limit the smallest working limit
  is 23 months (jump route, 34 engineers, 40-64%); from a B5 floor with a stricter target (40 engineers, 60%) lowering to B4 works.
- A short note on honesty: these are comparisons within a synthetic cohort, a relaxation is not a promise, ranges overlap, thin evidence
  is flagged in the sentence.
- A table of the new files with one line each.
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "This part is deterministic and uses no model, so there is no live evaluation; its numbers are pinned by tests."
- Known limits: single-knob relaxations only (no combinations); the tornado tries fixed values; skills and risk tolerance are not covered;
  a relaxation can be large (give the real example: a pay floor of B5 with a 24-month limit and a 10-engineer target may suggest a very
  long time limit; verify an example from the code before quoting it).
- How to verify: npm run check.

## Rules
- BUG HUNT: if you find a bug in src/, do not fix it and do not write a failing test. Describe it in your final message (file, line,
  what is wrong, a concrete input that shows it, suggested fix). Look especially at: relaxation loops (off-by-one, termination,
  wrong direction), band index handling in minCompBand (B1 edge, unknown labels), the tie-breaking in the tornado sort, and
  meetsTarget with unusual targets.
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

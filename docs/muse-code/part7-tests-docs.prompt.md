# Task: extra tests, a bug hunt and a docs page for Part 7 (tests and docs only)

Read AGENTS.md first and follow it. Part 7 made the What-if knobs move real evidence and added a diff engine
and a grounded narrator. The code is implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION.
You must NOT change any file under src/, evals/ or scripts/.

## Read first (do not edit)
src/lib/tools/pathStats.ts, skillStats.ts, stats.ts (wilsonInterval, Band), toolSchemas.ts (LimitsSchema),
src/lib/engine/facts.ts (limitsOf, SkillFacts), rank.ts, src/lib/whatif/diff.ts, narrate.ts, run.ts, conflicts.ts,
and the existing tests: tests/limitsAndRanking.test.ts, tests/whatifDiff.test.ts, tests/whatifNarrate.test.ts,
tests/whatifConflicts.test.ts, tests/helpers/fixturesData.ts. Do NOT duplicate what those already test; add what is missing.

## Create these test files (Vitest, deterministic, offline, no live API)

1. tests/wilson.test.ts for wilsonInterval in src/lib/tools/stats.ts
   - n = 0 returns [0, 0]; k = 0 gives a lower bound of 0 and an upper bound above 0; k = n gives an upper bound of 1
     and a lower bound below 1; both ends are always within [0, 1], low <= high, rounded to two decimals;
     the interval narrows as n grows for the same proportion (compare n=10, 100, 1000 at p = 0.5);
     it contains the observed proportion; for a few known values check against hand-computed Wilson results
     (for example 8 of 10 is about [0.49, 0.94]; show your arithmetic in a comment and use a tolerance of 0.01).
   - It must give exactly the numbers pathStats reports for the unconstrained case (call pathStats and compare
     reachedRate with wilsonInterval(reachedN, n) for each archetype).

2. tests/toolLimits.test.ts for the argument validation and the evidence ledger around limits
   - LimitsSchema: maxMonths accepts integers 1 to 240 and rejects 0, 241, 1.5, strings; minCompBand accepts B1 to B5 and
     rejects "B6", "b3", numbers; an empty object is valid; unknown keys are handled sensibly (state what happens and test it).
   - ToolArgSchemas.skillStats: skill must be 1 to 40 characters; twinIds capped at 2000; archetype validated.
   - the ledger records pathStats and skillStats calls with limits in args, and callUntrusted rejects bad limits with a
     message starting "Invalid arguments for".
   - summarizeEvidence for skillStats: a known skill (mentions both groups' n and says "(limited evidence)" when thin) and an
     unknown skill (says there is no cohort evidence). Use real tool results.
   - the verifier's sampleSize for skillStats is not exported, so test it indirectly only if you can; otherwise skip and say so.

3. tests/skillStatsEdges.test.ts
   - empty twinIds: known skill gives both groups n = 0, distinguishable false, evidenceThin true.
   - duplicate twin ids count once; unknown ids are ignored.
   - a skill present in 100% of a tiny twin set leaves withoutSkill.n = 0 and distinguishable false (build the twin set from
     real cohort ids that all share a skill; find them in the cohort data via COHORT).
   - monthsP50 is null when nobody in a group reached the goal.
   - matchCohortSkill: every alias in the module resolves to a skill that exists in COHORT_SKILLS (test through the public
     function with each alias key you can read from the source); uppercase, extra spaces, trailing spaces; the empty string
     and strings made only of spaces return undefined; "system design" and "system-design" both resolve.
   - COHORT_SKILLS is sorted, unique and non-empty.

4. tests/diffEdges.test.ts for src/lib/whatif/diff.ts (do not repeat tests/whatifDiff.test.ts)
   - diffSheets(a, a) for the same sheet object is unchanged with no facts.
   - symmetric behaviour: diff(A to B) has a disappeared route exactly where diff(B to A) has an appeared route.
   - a route with n = 0 on both sides is unchanged and produces no facts.
   - a route that goes from thin to not thin or vice versa still produces consistent text (thin facts say "limited evidence").
   - facts for a changed pay band range use the "B4-B5" / "B5" format (never "B5 to B5").
   - every fact has at least one of: non-empty evidenceIds, or kind in {recommended, skill with unknown cohort evidence}; assert this
     across several scenarios and say clearly in a comment what you found if some other fact kind has no evidence ids.
   - mustMention is true for route_appeared, route_disappeared, recommended; false for risk, comp, twin_pool, timeline.
   - facts are returned in a stable order across repeated calls (determinism): call twice and compare with toEqual.

5. tests/rankEdges.test.ts for rankRoutes
   - all three routes have no one who reached the goal: order is the fixed climb, jump, pivot and recommended is null.
   - exactly one eligible route is recommended whatever the risk tolerance.
   - two eligible routes with identical keys and identical months: order stays climb before jump before pivot.
   - a route with monthsToGoal null but eligible loses a tie against one with a timeline (read the code to confirm the intended behaviour).
   - the returned order is always a permutation of the three archetypes.
   - basis text differs per tolerance and mentions the tolerance word.

## Create docs/parts/part-7-evidence-knobs-diff-narrator.md
Plain-language guide for someone new to the project. Include:
- The problem: in Part 6 only two of six knobs changed any number. A slider that moves nothing is decoration. Part 7 makes
  every knob do something real, and explains each change in words that cannot invent facts.
- A table of the six knobs: knob, what it does to the evidence, where in the code (read pathStats.ts, findTwins.ts, rank.ts, facts.ts).
  Be exact: remote and noRelocation change who counts as a comparable engineer; maxMonths and minCompBand change what counts as
  having reached the goal (within the person's limits); riskTolerance changes the order routes are suggested in by choosing which end
  of the success interval ranks them; addSkills adds a with-versus-without comparison per route and does not change the headline numbers.
- A worked example with real numbers from this repository's sample engineer (backend, L5 to Staff, IN-south). Compute them by running
  the code in a test or script of your own and quote exactly: with no limits the climb route is 74-92% over 55 comparable engineers;
  with a 24-month limit the climb and pivot routes have nobody who reached the goal in time and jump remains. Verify before you write.
- "Reached within your limits": explain the five outcome shares (reached within limits, reached outside limits, stalled, left the field)
  and why people who reached the goal late are reported separately and not as failures.
- Skills: association not cause; the distinguishable flag (true only when the two success ranges do not overlap); unknown skills; the
  alias list; that in this synthetic cohort no skill separates the groups, so the honest answer is "we cannot tell".
- Risk tolerance: the three ordering rules with a small made-up example (clearly labelled as illustration).
- The diff engine: facts are sentences written by code with their numbers listed; the thresholds (5 percentage points, 3 months,
  10 percent outside limits); "real change" versus "may be noise"; the mustMention rule.
- The narrator: the pipeline (facts, model picks and phrases, verifyNarration, one repair attempt, template fallback), a table of the
  checks verifyNarration makes, and why the template fallback is a floor and not a failure.
- A table of the new and changed files with one line each.
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "Results of the live evaluation are added by the maintainer after measurement." (do not invent numbers).
- Known limits: skills are limited to the six the cohort records; time and pay limits shrink the sample so intervals get wide;
  the narrator is a model and its wording can be stiff even when valid; English only.
- How to verify: npm run check; npm run live:whatif-run with both API keys exported.

## Rules
- BUG HUNT: if you find a bug in src/, do not fix it and do not write a failing test. Describe it in your final message
  (file, line, what is wrong, a concrete input that shows it, suggested fix). Look especially at: pathStats outcome shares adding to 1
  under limits; the Wilson interval; rankRoutes tie-breaking and its sort comparator consistency; diffSheets when a route has n = 0;
  verifyNarration regexes; supportedNumbers/ungroundedNumbers with percentages; anything that could throw on empty input.
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

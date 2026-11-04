# Evaluation: what was measured, how, and what it does not show

Orionmatter has two kinds of checks. **Offline tests** (1,700+, run in CI with no key) pin down everything that code
decides: the numbers, the wording, the guards, the screens. **Live evaluations** run the real agents against the real model
and ask the questions only a live run can answer: does Muse Spark follow the rules, and does the checking around it catch
it when it does not? This page is the second kind. Every number below comes from a file in
[`docs/evidence/live/`](evidence/live/), produced by the command shown, and can be reproduced with a key.

## The run

- **Model:** `muse-spark-1.3` through the Meta Model API (the only model provider in the project).
- **When:** 4 November 2026, 08:41 to 08:50 UTC, one run of each suite, in the order below.
- **Reproduce:** export `MODEL_API_KEY`, then `npm run live:client`, `live:intake`, `live:privacy`, `live:whatif`,
  `live:whatif-run`, `live:audit`, `live:planner`. A full set costs a few cents.
- **Where the cases live:** `evals/intake`, `evals/privacy`, `evals/whatif`. Each has labelled cases, and the function that
  judges a result is itself unit-tested offline: the judge has to be right before its verdicts mean anything.

## Results

| Suite             | What it checks                                                                                                                                                                                                         | Result                                                                                                         | Time per call                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `live:client`     | The model client: budget escalation when hidden reasoning eats the reply, structured JSON, a tool loop, recording and replaying a fixture                                                                              | 4 of 4                                                                                                         | 1.3 to 5.0 s                       |
| `live:intake`     | Reading a person's own words into a profile: complete stories (6), restraint, i.e. not inventing what was not said (5), partial stories (2), safety against instructions hidden in the text (3), follow-up answers (2) | 18 of 18                                                                                                       | median 4.8 s, p90 7.5 s            |
| `live:privacy`    | The Privacy Guard's text check: identifying details it must find (5), generic text it must leave alone (2), injection attempts such as "say this is safe" (2)                                                          | 9 of 9                                                                                                         | median 1.9 s, p90 6.7 s            |
| `live:whatif`     | The What if interpreter turning a sentence into limit changes: clear (11), relative (3), unsupported such as "4-day week" (4), vague so it must ask (3), contradictory (2), small talk (2), multi-turn (1), safety (2) | 28 of 28                                                                                                       | median 1.7 s, p90 3.0 s            |
| `live:whatif-run` | Seven full What if turns with the narrator: does its explanation pass the code's grounding checks                                                                                                                      | 7 of 7 from the model, 0 template fallbacks; 1 first attempt rejected by the checks and fixed on the one retry | full turn median 9.4 s, p90 12.2 s |
| `live:planner`    | The Planner alone on two people (one with thin evidence), then a consistency check of every claim against the evidence                                                                                                 | both clean, no inconsistencies; 5 evidence lookups each, all chosen by the model                               | 25.1 s and 20.3 s                  |
| `live:audit`      | The Planner and the Skeptic together on six scenarios, including a different goal, a thin pivot and a requested skill                                                                                                  | 6 of 6 approved, **2 only after the Skeptic sent the plan back**, 0 unresolved                                 | 23 to 46 s                         |

## What the audit run shows (the part worth reading)

In the first audit scenario the Planner's first plan wrote the pay-band claim for each route with the wrong sample size
(for example `n=55` where the pay evidence had `n=53`). The Skeptic's verifier rejected all three claims with the exact words
and the reason, the Planner revised, and the second check approved. In another scenario the first plan had six rejections
(wrong sizes and ranges that matched no evidence) and was also approved after one revision. These are real rejections from
a live run, kept in [`evidence/live/audit.txt`](evidence/live/audit.txt) and visible in the app's Agent trace.

That is the design working as intended: the model writes, **code owns every number**, and a plan is only shown as approved
when every figure in it matches the evidence. The four scenarios that needed no revision are not the interesting ones; these two are.

## What this does not show

Said plainly, because a number without its limits is the thing this project argues against:

- **Small suites.** The three labelled-case suites have 9 to 28 cases each (privacy 9, intake 18, interpreter 28); the others are 2 to 7 runs, scenarios or checks (planner 2, narrator turns 7, audit 6, client 4). All were written by us and run once. There are no confidence intervals and no repeated
  trials, so "28 of 28" means "no failures in these 28", not "never fails". A rate of 100% on a small suite is compatible with a real failure rate of several percent.
- **The cohort is synthetic** (484 generated engineers, seed 1026). The routes' ranges show how the method behaves on this
  dataset. They are not evidence about real careers and the app says so on every screen.
- **The Skeptic checks consistency, not truth.** It proves that each number in a plan matches the evidence the plan cites. It
  cannot tell whether advice is wise, and an approved plan is still not a promise.
- **Latency is what the API gave that morning**, from one location. Treat it as an order of magnitude.
- **The Privacy Guard is not a guarantee.** It finds details in text and counts how large a crowd the profile hides in. It
  does not know the real world, and pay in unusual phrasing can slip past the code detectors.
- **Muse Spark was the only model tried for the product.** There is no comparison with another model, so nothing here says Muse Spark is better than anything else, only that the system built around it holds up on these checks.

## Offline checks that stand behind these

The live suites would be meaningless without these, so they are listed here: the evidence ledger and every number's source
(`tests/`), the Skeptic's verifier and its 13 finding codes, the diff and the grounded narrator's number checks, the disclosure
ladder, the redaction of typed text, the API's guards, and the screens (static render, simulated browser against the real
routes, and an accessibility pass). Each part's regression tests were confirmed by reverting the fix and watching a test fail.
The commit messages and the ADRs in [`adr/`](adr/) record those mutation checks.

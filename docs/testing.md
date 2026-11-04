# Testing: what is checked, by what, and what that does not prove

Four layers, from the cheapest and most frequent to the most realistic. Each answers a different question, and none of them
answers all of them.

| Layer            | Question it answers                                                          | Runs                         | Needs a key |
| ---------------- | ---------------------------------------------------------------------------- | ---------------------------- | ----------- |
| Offline tests    | Does the code do what it says, for the cases we thought of?                  | Every push (CI) and locally  | No          |
| Recorded replay  | Does the whole app work on real Muse Spark answers, with no network?         | In CI, and as the demo build | No          |
| Live evaluations | Does the real model follow the rules, and does the checking catch it if not? | By hand, a few cents per set | Yes         |
| The deployed app | Does what we shipped behave like what we tested?                             | By hand after each deploy    | Live only   |

## Offline tests (about 1,950 at the time of writing)

`npm test`, or `npm run check` for the full gate (types, lint, format, tests, secret scan). CI also builds the app and audits
production dependencies. The tests cover the engine and every number it produces, the Planner's tools, the Skeptic's verifier and
critic, What if, Intake, the Privacy Guard, the API routes and their limits, and the screens in a simulated browser against the
real routes. Conventions used throughout:

- **A scripted model.** Agents are tested with a mock that returns chosen replies, including malformed, oversized, hostile and
  truncated ones, so the guards are exercised and not assumed.
- **Mutation-checked fixes.** A regression test is accepted only after reverting the fix makes it fail. The Muse Code index
  ([`docs/muse-code/README.md`](muse-code/README.md)) records which bugs were found this way.
- **The documents are tested too.** Every link and `npm` command in the docs exists, the pictures in the README equal what the app
  draws now, and a scan keeps overclaiming words out of the screens and the judge-facing pages ([ADR 0018](adr/0018-two-deployments-and-documents-under-test.md)).
- **Patient waits.** `vitest.config.ts` makes screen tests wait five seconds instead of one. A CI run once failed on a race that
  only a slow runner exposed (the map had not yet redrawn when the plan came back); the cause was fixed in the code, and the wait
  was made less fragile.

## Recorded replay

`USE_FIXTURES=true` replays 38 recorded Muse Spark answers, keyed by the exact request. The demo journey test and
`npm run smoke -- <url> --plan` use it. It proves the app works end to end on real answers; it cannot show what the model would
say to a request that was not recorded (the app refuses those as `demo_only`).

## Live evaluations

[`docs/evals.md`](evals.md) has the suites, the results of two runs, the raw output in `docs/evidence/`, and a section on what
the numbers do not show. In short: 4 of 4, 18 of 18, 9 of 9, 28 of 28 and 7 of 7 in both runs, a clean Planner check, and every
audit plan approved (two, then three, of six after a Skeptic revision). `npm run live:injection` sends hostile input through the real
handlers: 14 of 14 held. These are small suites: "no failures in these cases" is not "never fails".

## The deployed app

After each deploy, `npm run smoke -- https://<site> --plan` (demo) or `--model` (live) checks the routes, then a person clicks through.
On the demo deployment, on 4 November 2026, the Map, What if, Plan, Privacy and Share screens were exercised in a real browser:
no console errors across the whole session, no alerts, no unnamed buttons or unlabelled fields on the Share screen (the one checked for that), tab-list keyboard navigation (arrows, Home, End) working,
the focus ring defined, and the dark-mode and reduced-motion rules present. The figures on screen agreed with each other.

## What is not tested

- **Whether the advice is right.** The cohort is synthetic; an approved plan means every figure matches its evidence.
- **A phone-sized screen on the deployed site.** The site refuses to be framed (`X-Frame-Options: DENY`, deliberately), so the
  phone layout was checked on rendered previews and by the CSS audit tests, not in a phone-sized browser on the deployment.
- **Dark mode on the deployed site by eye,** for the same reason: the browser used could not switch the colour scheme.
- **Load.** The live deployment calls a paid model and is rate limited per server instance; it was not load tested.
- **Security beyond the design.** The injection checks are a small set, not an audit; there is no authentication and nothing stored.
- **Property-based tests and mutation testing of the whole code base.** Not done; the verifier, the ladder and the engine have
  example-based and mutation-checked tests instead.

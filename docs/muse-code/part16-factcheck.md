# Part 16 fact-check: final documents against the repository

Scope: `README.md`, `docs/deploy.md`, `docs/demo.md`, `docs/submission.md`
checked against `package.json`, `next.config.ts`, `.env.example`,
`src/lib/env.ts`, the route files, the components, the smoke script,
the fixtures and the evidence files. Strict reading: an overstated claim
counts as wrong. (Test-count claims were confirmed against this run's own
`vitest` output; see the last Confirmed item.)

## Confirmed

- Model and provider: every model call goes to `muse-spark-1.3` through the
  Meta Model API. Default in `src/lib/env.ts:24`
  (`default("muse-spark-1.3")`, base `https://api.meta.ai/v1`); the honesty
  test fails the suite if any runtime file names a second provider
  (`tests/honesty.test.ts:84-94`).
- Environment names and defaults (`src/lib/env.ts:20-42`, `.env.example`):
  `MODEL_API_KEY` (required unless `USE_FIXTURES=true`),
  `RATE_LIMIT_PER_MINUTE=12`, `MAX_CONCURRENT_RUNS=6`, `LOG_LEVEL=info`,
  `COHORT_SEED=1026`, both fixture flags default `false`.
- `maxDuration`: plan 300, What if 120, intake 120, privacy 60
  (`src/app/api/plan|whatif|intake|privacy/route.ts`, `maxDuration` lines).
- Health route returns `ok`, `mode` (`live`/`fixtures`), `model`,
  `keyConfigured` and `cohort` (`src/app/api/health/route.ts:8-19`); the
  deploy guide's `"mode":"live"` / `"mode":"fixtures"` expectations match.
- Which routes call the model: explore declares `usesModel: false`
  (`src/app/api/explore/route.ts:14-15`); intake, What if, plan and privacy
  declare `usesModel: true` with the `model`/`plan` limiters.
- Rate limits are per visitor IP per server instance
  (`src/lib/api/route.ts:48-49,105`); the plan route gets
  `ceil(RATE_LIMIT_PER_MINUTE / 3)` (`src/lib/api/services.ts:55`).
- Smoke script: 5 checks with no flags, plus a What if check with `--model`,
  plus a plan check with `--plan` (so 7 with `--plan`),
  (`scripts/lib/smoke.ts`, `scripts/smoke-e2e.ts:13-16`). Exit code gates a
  deploy. The deploy guide's flag usage matches.
- Unrecorded requests are refused in words: `demo_only`, "that one was not
  recorded. Use one of the example buttons, or run the app with your own
  key" (`src/lib/api/errors.ts:128-130`).
- Demo banner text is exact: "Demo build: replaying recorded Muse Spark
  answers" (`src/components/PathApp.tsx:117`).
- Demo-script button texts are exact: "Use an example story"
  (`src/components/IntakePanel.tsx:74`), "Read it" (`:121`),
  "Use this for my routes" (`:381`), "Build my plan"
  (`src/components/PlanPanel.tsx:99`; becomes "Build it again" after a run),
  "Check with Muse Spark" (`src/components/PrivacyPanel.tsx:201`),
  "Use an example" (`:184`), "Which limit matters most"
  (`src/components/Insights.tsx:59`), "What if I want to get there within
  2 years?" (`src/ui/demo.ts:24`; the UI renders a typographic apostrophe).
- Tab order in the README table matches the app: Your story, Map, What if,
  Plan, Compare, Privacy, Share, Why (`src/components/PathApp.tsx:27-35`).
- The app opens on the map with a sample engineer
  (`src/components/PathApp.tsx:296,352-357`).
- Cohort: 484 records, synthetic, seed 1026 (`data/cohort.synthetic.json`).
- 17 ADRs (`docs/adr/*.md`), 137 test files ("130+"), 13 Skeptic finding
  codes (`src/lib/skeptic/findings.ts:10-23`).
- The Skeptic sent 2 of 6 audit plans back: "6 scenario(s), 2 needed
  revision, 0 unresolved" (`docs/evidence/live/audit.txt:48`); the
  rejections include wrong sample sizes (`n_mismatch`) and unsupported
  ranges (`range_unsupported`), matching the submission text.
- "A live plan took 20 to 50 seconds": the evals give 20.3/25.1 s
  (planner) and 23-46 s (audit) (`docs/evals.md:27-28`).
- Only an approved plan puts steps on the map
  (`src/ui/plan.ts:92-100`).
- A stale answer cannot overwrite a newer one: replaced chat responses
  return early on abort (`src/components/usePathState.ts:102-103,112`).
- Logs: one line per request with route/status/timing and never the request
  content (covered by `tests/apiRoutes.test.ts:395`); the key is redacted
  from every log line (`src/lib/api/services.ts:37-45`, `src/lib/log.ts`).
- Nothing is stored: no `localStorage`, `sessionStorage` or `indexedDB`
  anywhere under `src/`; plans/scenarios/chat live in React state, so "not
  saved across reloads" holds.
- Typed text has emails, phone numbers and links removed before reading
  (`src/lib/intake/redact.ts` via `redactPii`); a screenshot "is sent to
  the model as it is" (`src/lib/intake/intake.ts:221`).
- Fixtures ship with every API route via `outputFileTracingIncludes`
  (`next.config.ts:9`); recordings live in `src/fixtures/` and are redone
  with `RECORD_FIXTURES=true npm run record:demo`, which refuses to run
  without the flag (`scripts/record-demo-fixtures.ts:28-29`).
- Node: repo requires >= 20 (`package.json` engines), CI uses 22
  (`.github/workflows/ci.yml`).
- Every npm command named in the four docs exists in `package.json`
  (`dev`, `build`, `start`, `check`, `test`, `smoke`, `live:audit`,
  `record:demo`, `docs:images`, `ci` is npm itself).
- Muse Code 1.4.14 is the recorded version (`docs/api-notes.md:99`); the
  Part 2 contributor-mode run is disclosed in `docs/muse-code/README.md`
  and `docs/adr/0003-secrets-and-muse-code-safety.md` (file exists).
- Part 14 needed a second run: `part14b-card-bughunt.*` files exist.
- Troubleshooting strings: "The model is not configured on this server"
  is exact (`src/lib/api/errors.ts:134`); "The model is busy" is the start
  of the real "The model is busy or unreachable..." (`:146`).
- Privacy default k = 10 (`src/ui/privacy.ts:17`); the demo script's
  "crowd of ten or more" matches.
- What if guards: contradictions are computed and blocked
  (`src/lib/whatif/apply.ts:174-175,266`), vague input becomes a question
  and unsupported input is listed (`src/lib/whatif/interpret.ts:8`);
  narrator numbers must all be computed ones
  (`src/lib/whatif/narrate.ts:111,131` via `ungroundedNumbers`).
- The Planner backfill ("code fills it in and the trace says so") exists
  (`src/lib/agents/planner.ts:104`; audit lines "engine filled in").
- The demo script's "What not to say" words match the banned list in
  `tests/honesty.test.ts:25-35` (predicts, guarantees, will reach,
  accurate, real data, on-device, private by default, open weights,
  screens candidates).
- `LICENSE` exists (MIT); the README links table sits in the first screen
  (`README.md:15-19`).
- Test totals: this run's `npm run check` reports 140 files, 1946 passed
  and 1 skipped, so "1,800+" (README, submission) and "1,700+"
  (`docs/evals.md`) both hold.

## Wrong or overstated

- Quote (`README.md`, "Built with Muse Code"): "Its work is committed with
  an `Assisted-by: Muse Code` trailer (15 commits so far, over 14 recorded
  runs)."
  What is true: `docs/muse-code/` holds 16 `*.prompt.md` files (up to
  `part16-factcheck-tests.prompt.md`), and 16 commits carry the trailer.
  The count is stale. (One trailer commit is the Part 1 scaffold, but even
  then the "14 runs" figure understates the 16 recorded runs.)
- Quote (`README.md`): "Each run is recorded in `docs/muse-code/`: the
  exact prompt, its final message, and a redacted session export".
  What is true: the `part16-factcheck-tests` run has a prompt, a final
  message and a stderr log but no `.session.json.gz` (`ls
  docs/muse-code | grep part16`). "Each run" overstates.
- Quote (`README.md`): "Muse Code was then given the committed code and
  told to change **only tests and docs**. Each run was checked afterwards:
  ... `git status` shows no source file touched".
  What is true: the Part 2 commit `aade90f` ("docs: JSDoc, edge-case tests
  and data-layer guide written by Muse Code (Part 2)") edited
  `src/lib/schemas.ts`, `src/lib/tools/compBands.ts`,
  `src/lib/tools/data.ts`, `src/lib/tools/findTwins.ts` and
  `src/lib/tools/kAnonymity.ts` (header/JSDoc comments only; the message
  says compiled output is identical). The blanket "no source file touched"
  is false for Part 2.
- Quote (`README.md`, judging table, Demo row): "The app opens on a sample
  engineer and has one-click examples on every tab."
  What is true: one-click example buttons exist on Your story ("Use an
  example story"), What if (`WHATIF_EXAMPLES` in `src/components/Chat.tsx`)
  and Privacy ("Use an example"). Map, Plan, Compare, Share and Why have
  no example buttons (`grep -rln "example" src/components/*.tsx` hits only
  Chat, Controls (a placeholder), IntakePanel, PrivacyPanel). "Every tab"
  overstates.
- Quote (`docs/deploy.md`, Project 1 table): "without it every route fails
  at start-up and `/api/health` will not answer".
  What is true: the health route calls `getServices()` → `getEnv()`,
  which throws, so Next answers with a 500 — as the same document's
  troubleshooting table says ("/api/health returns 500"). "Will not
  answer" is wrong.
- Quote (`docs/deploy.md`, comparison table): the demo build is "never
  rate-limited".
  What is true: deterministic routes (the ones the demo uses most) go
  through the `light` limiter at 10x the model rate
  (`src/app/api/explore/route.ts:14`, `src/lib/api/services.ts:56`), so a
  flood of visitors can still be refused. "Never" overstates.
- Quote (`README.md`): Muse Code was in the loop "from the data layer
  (Part 2) to the offline demo and docs (Part 15)".
  What is true: a Part 16 run (`part16-factcheck-tests.*`) is already
  recorded in `docs/muse-code/`. The range is stale.
- `docs/demo.md` shot list is misnumbered: "1. ... 2. ... 3. ... 4. ...
  2. The Share card." The last item should be 5.

## Cannot be checked from the repository

- The deadline (4 November 2026, 9:00 PM ET), the Indie track and the "Build
  for Your World" problem statement: external hackathon facts.
- The judging rubric and "equally weighted": the repo states this
  (`docs/demo.md`) but no in-repo source can confirm a rubric.
- "More than 35 real bugs": the per-run index lists findings, but counting
  "real bugs" needs a case-by-case review that the time box did not allow.
- "Each one fixed with a regression test confirmed by reverting the fix":
  needs per-fix mutation verification; spot checks only.
- Cost claims ("a few cents per plan", "a full set costs a few cents"):
  the repo has no cost metering; API pricing is external.
- Timing claims ("well under a second" replay, "milliseconds" sliders,
  "about half a minute" live): live timing, not statically checkable
  (order of magnitude matches `docs/evals.md`).
- Vercel behaviour (framework detection, settings pages, function duration
  caps, About-box links): product facts outside the repo.
- "Muse Spark was the only model tried": an absence claim about work done
  outside the repo.
- That `https://api.meta.ai/v1` is the real Meta endpoint: a network fact;
  tests use fixtures and loopback servers.
- "Main is green in the Actions tab" and "no secret scanning alert": live
  CI/GitHub state at submit time (the tree's own `scan:secrets` passes in
  `npm run check`).
- Whether a judge can reproduce the live evals: needs a key and network.

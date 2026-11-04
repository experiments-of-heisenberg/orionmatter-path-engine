# Part 15 fact-check: README.md and docs/evals.md against the repository

Checked 4 November 2026 against the committed tree (HEAD 2588f03) plus the
untracked Part 15 run scaffolding. Test counts from `npx vitest run` (131 files,
1800 passed, 1 skipped). "Wrong" includes overstated.

## Confirmed

- Test totals: README's "1,800 tests" (Technical depth row and `npm run check`
  comment) and evals.md's "1,700+": the suite runs 1800 passed, 1 skipped.
- Counts: 17 ADRs in `docs/adr/`; 13 Skeptic finding codes (the `FindingCode`
  union in `src/lib/skeptic/findings.ts`); cohort of 484 records with seed 1026
  (`data/cohort.synthetic.json`); 4 What-if examples (`WHATIF_EXAMPLES`).
- Tabs: `TABS` in `src/components/PathApp.tsx` has exactly the 8 README labels
  in order (Your story, Map, What if, Plan, Compare, Privacy, Share, Why).
- Offline demo: replay banner text matches `PathApp.tsx` exactly; `demo_only`
  code/422/message match `src/lib/api/errors.ts`; `outputFileTracingIncludes`
  in `next.config.ts` lists `./src/fixtures/**/*`; gather prompt states the
  limits (`plannerPrompts.ts`); 38 fixture JSONs in `src/fixtures/`.
- Scripts: every referenced name exists in `package.json` (`live:client`,
  `live:intake`, `live:privacy`, `live:whatif`, `live:whatif-run`, `live:audit`,
  `live:planner`, `record:demo`, `smoke`); `npm run smoke -- <url> --plan`
  works (`scripts/smoke-e2e.ts`: positional URL, `--plan` implies `--model`).
- Evals table: all seven rows match `docs/evidence/live/*.txt`, including
  category splits (intake 6/5/2/3/2, privacy 5/2/2, whatif 11/3/4/3/2/2/1/2),
  medians/p90s (client 1.3-5.0 s; intake 4.8/7.5 s; privacy 1.9/6.7 s; whatif
  1.7/3.0 s; whatif-run 9.4/12.2 s), planner (5 lookups each, 25.1/20.3 s, no
  inconsistencies) and audit (6/6, 2 revisions, 0 unresolved, 23-46 s).
- Audit narrative: scenario 1's three `n_mismatch` rejections (`n=55/65/30`
  vs pay evidence `n=53`) and scenario 4's six rejections, each approved after
  one revision, are in `audit.txt` verbatim.
- Muse Code loop: 15 commits carry an `Assisted-by` trailer (14 run commits +
  the Part 1 scaffold note) for 14 recorded runs (parts 2-14 plus 14b; the
  Part 15 prompt/final files are untracked scaffolding for the run in
  progress); the index counts more than 35 fixed bugs; all six README bug
  examples, the Part 14 15-minute-cap story and the Part 2 contributor-mode
  disclosure (ADR 0003, Disclosure) match the index; spot-checked run commits
  touch no file under `src/`, `scripts/`, `evals/` or `next.config.ts`.
- Routes and guards: all five diagram routes plus `/api/health` exist;
  `/api/explore` imports no model code; `unresolved` status exists
  (`orchestrator.ts`); quote/number guards exist (`narrate.ts`,
  `ungroundedNumbers`); judges are unit-tested for all three suites
  (`tests/*EvalMatcher.test.ts`); no `localStorage` in `src/` (nothing
  persists across reloads); `process.env` in `src/` appears only in
  `src/lib/env.ts`, and the smoke test asserts the page never mentions
  `MODEL_API_KEY` and health returns nothing key-shaped.
- Start of the live run: `client.txt` opens at 08:41:59 UTC on 4 Nov 2026.
- Supporting details: `CROP_WARNING` backs the screenshot/redaction limits;
  `docs/api-notes.md` records that hidden reasoning counts against the budget;
  the header chip "Synthetic cohort of 484 engineers" renders on every tab.

## Wrong or overstated

1. README: "130 test files" (`tests` row of the Repository tour).
   True: 131 test files (`find tests -name "*.test.*"`; vitest reports 131).
2. README: "Script and shot list: [`docs/demo.md`](docs/demo.md)" (Demo row).
   True: `docs/demo.md` does not exist; the link is broken.
3. `docs/evals.md`: "**Small suites.** 9 to 28 cases each" (What this does not
   show). True: only the three labelled-case suites have 9-28 cases (privacy 9,
   intake 18, whatif 28). `live:client` has 4 checks, `live:planner` 2
   scenarios, `live:whatif-run` 7 turns and `live:audit` 6 scenarios, per the
   evidence files. As written, "each" is false.
4. `docs/evals.md`: "The two scenarios that needed no revision are not the
   interesting ones" (What the audit run shows). True: four scenarios needed
   no revision (2, 3, 5, 6); two needed one revision (1, 4). `audit.txt` ends:
   "6 scenario(s), 2 needed revision".
5. README diagram: "TOOLS[Tools: findTwins, pathStats, skillStats, compBands,
   k-anonymity]". True: the ledger tools (`ToolArgSchemas` in
   `src/lib/tools/toolSchemas.ts`) are findTwins, pathStats, skillStats,
   levelMap and compBands. `levelMap` is missing from the diagram and
   k-anonymity is not a ledger tool (it is part of the Privacy Guard).
6. README: "Muse Code ... was part of the development loop for every part of
   the project from the data layer onward" (Built with Muse Code). True: at
   this commit, recorded runs cover parts 2-14 (plus 14b). Part 15 itself had
   no recorded run yet; the run now in progress closes that gap.

## Cannot be checked from the repository

- Muse Code version 1.4.14: no version record is kept in the repo (only model
  ids inside the session exports).
- "A full set costs a few cents": no cost record in the repo.
- Run window end (08:50 UTC), "one run of each suite, in the order below",
  and latency "from one location": only `client.txt` carries timestamps, and
  no location is recorded.

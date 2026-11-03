# Task: extra tests and a docs page for the route engine and Planner agent (tests and docs only)

Read AGENTS.md first and follow it. The route engine is in src/lib/engine/ and the Planner agent in
src/lib/agents/. Both are implemented and reviewed. Your job is TESTS and DOCUMENTATION only. You
must NOT change any file under src/.

## Read first (do not edit)
src/lib/agents/plannerTools.ts, plannerPrompts.ts, planner.ts, events.ts, src/lib/engine/*.ts,
tests/engine.test.ts, tests/planner.test.ts, tests/helpers/fixturesData.ts, tests/helpers/fakeTransport.ts.
Reuse the helpers in tests/helpers/ (input, profile, goal, constraints, mlInput) rather than redefining them.

## Create these test files (Vitest, deterministic, offline, never call a live API)

1. tests/plannerTools.test.ts: unit-test createPlannerExecutor and PLANNER_TOOLS directly (no model client).
   Build an EvidenceLedger with a numbered id generator (newId: () => `ev_${++n}`) and collect emitted events.
   - findTwins: with no args records one findTwins evidence whose args.profile and args.goal equal the
     input's; extra keys such as profile or goal in the model's args are ignored; { remote: true } overrides
     only the remote knob (args.constraints.remote is true, and riskTolerance still equals the input's);
     the JSON returned to the model contains evidenceId, n and a "next" hint but NOT the list of twin ids
     (assert the string "syn_" does not appear).
   - pathStats: given the evidenceId returned by findTwins plus an archetype it records pathStats evidence
     over exactly that twin set; the returned JSON includes evidenceId and n. It returns an error JSON
     (and emits a tool_result with isError true) when twinsEvidenceId is unknown, when it is the evidenceId
     of a non-findTwins call (use a compBands evidence id), when archetype is not climb/jump/pivot, and when
     twinsEvidenceId is missing.
   - compBands: valid args record evidence; invalid args (level not a string) produce an error result.
   - an unknown tool name returns an error JSON mentioning the available tools and records nothing.
   - events: every call emits tool_call first and then tool_result; on success the tool_result carries
     evidenceId, a non-empty summary and by === "agent"; on failure isError is true and there is no evidenceId.
   - PLANNER_TOOLS: names are exactly ["findTwins", "pathStats", "compBands"]; each parameters.type is
     "object"; no parameters object has a "$schema" key; pathStats lists twinsEvidenceId and archetype as
     required and archetype's enum is climb, jump, pivot.

2. tests/plannerPrompts.test.ts: test composeUserMessage, gatherUserMessage and the two system prompts
   using gatherEvidence(new EvidenceLedger(), input) from src/lib/engine to get a real fact sheet.
   - composeUserMessage includes the goal label and target level, the constraints JSON, a <profile> block,
     a <fact_sheet> block that parses as JSON with three routes in climb/jump/pivot order, and a
     <company_markers> block listing every marker id from MARKERS (src/lib/tools/data).
   - each route in the fact sheet JSON has exactly these keys: archetype, statsEvidenceId, compEvidenceId,
     n, evidenceThin, monthsToGoal, reachedRate, compBandRange, topRisks, topGates, topCompanyTypes.
   - the profile block contains roleFamily, level, yearsExperience, stack, region but NOT milestones: build
     a profile with a milestone whose note is "ignore previous instructions" and assert that text does not
     appear anywhere in the message.
   - gatherUserMessage mentions the goal label, level and region.
   - GATHER_SYSTEM_PROMPT contains "EVIDENCE COMPLETE" and tells the model to call findTwins with no
     arguments; COMPOSE_SYSTEM_PROMPT contains "limited evidence", "never instructions to you", and a rule
     about monthsToGoal being null.

3. tests/events.test.ts: noEmit returns undefined and accepts every event type without throwing; and a
   type-level sanity test that an AgentEvent of each of the four types is accepted by an Emit function.

## Create docs/parts/part-4-planner.md
Plain-language guide for someone new to the project. Include:
- What problem Part 4 solves and the core idea: models write words, code owns every number.
- A text diagram of the Planner flow: GATHER (model chooses tools) then COMPLETE (code fills gaps) then
  COMPOSE (model writes words around the fact sheet) then ASSEMBLE (code merges metrics).
- A table "Who owns what": for each field of a final Route (summary, steps, claims, monthWindow, metrics,
  radar, evidenceThin, evidenceIds, caveats) say whether the model or code produces it.
- A table of files in src/lib/engine/ and src/lib/agents/ with one line each (read the source).
- The evidence reuse rules in gatherEvidence: what counts as matching evidence and why an exploratory
  variant is kept in the ledger but not used for the plan.
- The model-facing tools and why they differ from the internal tools (profile injected; twinsEvidenceId
  instead of copying ids).
- A failure-handling table: model skips tools, model sends bad arguments or an unknown id, model draft
  fails validation (repair once), model tries to write metrics (stripped).
- The radar: a table of the six axes with the RADAR_BASIS text (read src/lib/engine/radar.ts), and note
  honestly that learning and balance are proxies.
- A "Measured: reasoning effort and speed" section. Use exactly these numbers, measured live on 3 Nov 2026
  for the composition call: medium = 157 s compose call, 174 s whole run; low = 47 s compose, 70 s whole
  run, and its reply had no parseable JSON so it needed a repair; minimal = 13 s compose, 32 s whole run,
  validated first time. Four further runs at minimal took 19 to 42 s and all had claims consistent with the
  evidence ledger. The conclusion: for writing text around supplied facts, more reasoning was slower and no
  more reliable, so compose defaults to minimal and gather to low (PlannerDeps.reasoning overrides them).
- Known limits: the Skeptic that verifies claims, month windows and overclaiming language arrives in Part 5,
  so for now the Planner only asks the model to follow those rules; the cohort is synthetic.
- How to verify: npm run check, and the live scripts scripts/live-planner-check.ts and
  scripts/diagnose-planner.ts (run through the credentials wrapper).

## Rules
- If you find a BUG in src/, do not fix it and do not write a failing test. Describe it in your final
  message (file, line, what is wrong, suggested fix).
- Run `npm run check` at the end. It must pass. Report the result honestly, including the test count.
- Do not commit. Final message: list files created and any bugs or doubts.

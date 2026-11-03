# Task: extra tests and a docs page for the Skeptic (tests and docs only)

Read AGENTS.md first and follow it. The Skeptic is in src/lib/skeptic/, the revision loop in
src/lib/orchestrator.ts, and the revision prompt in src/lib/agents/plannerPrompts.ts. All are
implemented and reviewed. Your job is TESTS and DOCUMENTATION only. You must NOT change any file under src/.

## Read first (do not edit)
src/lib/skeptic/*.ts, src/lib/orchestrator.ts, src/lib/agents/plannerPrompts.ts (revisionUserMessage),
src/lib/agents/planner.ts (revisePlan), src/lib/schemas.ts (Rejection, SkepticVerdict),
tests/verifier.test.ts, tests/critic.test.ts, tests/orchestrator.test.ts, tests/helpers/fixturesData.ts.
Reuse the helpers in tests/helpers/ rather than redefining them.

## Create these test files (Vitest, deterministic, offline, never call a live API)

1. tests/textChecks.test.ts for src/lib/skeptic/textChecks.ts
   - findOverclaim: returns the lower-cased first promise word for each of will, guarantee, guaranteed,
     certain, certainly, definitely, always, never, ensures, proven, surefire, promise; is case-insensitive;
     returns undefined for text with none; does NOT match inside longer words (willing, alwaysday, nevertheless
     is NOT a match for "never", unproven is not "proven").
   - numbersIn: "n=65" gives [65]; "56% to 78%" gives [56, 78]; "18-23 months" gives [18, 23]; decimals like
     "1.5 moves" give [1.5]; band labels, levels and ids give []: "B4-B5", "L6", "ev_12", "m_fintech".
   - numericLeaves: flattens numbers from nested objects and arrays, ignores strings, booleans, null and
     non-finite numbers (NaN, Infinity).
   - supportedNumbers: a fraction 0.56 supports both 0.56 and 56; an integer such as 65 supports 65 only;
     0 and 1 are not converted to percentages; rounding to two decimals makes 0.1+0.2 support 0.3.
   - ungroundedNumbers: returns only the numbers not in the supported set; empty when all are grounded.
   - mentionsLimitedEvidence: case-insensitive match on "limited evidence"; false for "limited data".

2. tests/findings.test.ts for src/lib/skeptic/findings.ts
   - toRejections maps each Finding to a Rejection with source "verifier", code, routeIndex, claimText from
     the finding's text and reason from its message; includes stepIndex only when the finding has one
     (assert the key is absent, not undefined, when it does not); preserves order; empty in, empty out.
   - every output validates against the Rejection schema from src/lib/schemas.

3. tests/revisionPrompt.test.ts for revisionUserMessage in src/lib/agents/plannerPrompts.ts
   - lists every rejection numbered from 1 with its code in square brackets, the quoted text and the problem;
   - names the route as climb, jump or pivot for routeIndex 0, 1, 2; says "the plan as a whole" for -1; says
     "step N" (1-based) when stepIndex is present and omits it otherwise;
   - tells the model to return the COMPLETE corrected JSON with all three routes and to keep what was not criticised;
   - handles critic-sourced rejections the same way; handles an empty rejection list without throwing.

4. tests/skepticSchemas.test.ts
   - SkepticVerdict accepts a valid verdict and rejects one whose rejection lacks code or source or has a
     non-integer routeIndex; Rejection.stepIndex is optional; RejectionSource accepts only verifier and critic.
   - CriticOutput (from src/lib/skeptic) accepts valid output, rejects severity values other than reject/note,
     rejects more than 8 issues, rejects a quote longer than 300 characters, and rejects a non-integer routeIndex.

## Create docs/parts/part-5-skeptic.md
Plain-language guide for someone new to the project. Include:
- The problem: a model can write confident, wrong or over-promising claims; the Skeptic is the part of
  the system that audits the plan, and a plan is never returned unchecked.
- A text diagram of the pipeline: plan, audit (layer 1 verifier then layer 2 critic), reject?, revise,
  re-audit, up to two revisions, then approved or unresolved.
- A table of every verifier check: finding code, what it catches, and a one-line example (read
  src/lib/skeptic/findings.ts and verifier.ts; there are thirteen codes).
- How numbers in prose are checked ("every number must appear in the evidence it cites"), including that
  percentages are matched against fractions, and that band labels like B4 and levels like L6 are not numbers.
- The critic: what it looks for, why it only runs once the verifier is clean, and the hallucination guard
  (an issue is discarded unless its quote is found verbatim in the route it names).
- The revision loop: how many audits happen (initial plus one after each revision), what the revision
  prompt contains, why the fact sheet does not change during revision, and what "unresolved" means and how
  it must be presented (never as verified).
- How windows are judged against the ledger, not the route's own metrics, and why (a tampered metric is
  reported once rather than skewing every window).
- A "Measured live" placeholder section titled "Live results" containing exactly this single sentence:
  "Results of the live audit runs are added by the maintainer after measurement." (do not invent numbers).
- Known limits: the cohort is synthetic so "faithful to the evidence" is not "true in the world"; the
  critic is a model and can miss problems; overclaim detection is a word list, so it can have false
  positives and cannot catch every kind of overclaim.
- How to verify: npm run check, and scripts/live-audit-check.ts through the credentials wrapper.

## Rules
- If you find a BUG in src/, do not fix it and do not write a failing test. Describe it in your final
  message (file, line, what is wrong, suggested fix). Pay particular attention to findOverclaim's word
  boundaries and to numbersIn edge cases.
- Run `npm run check` at the end. It must pass. Report the result honestly, including the test count.
- Do not commit. Final message: list files created and any bugs or doubts.

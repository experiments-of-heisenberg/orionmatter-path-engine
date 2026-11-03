# Part 5: The Skeptic (audit and revision)

**Goal:** never return a plan unchecked. A second agent, the Skeptic, audits every
plan the Planner writes — first with deterministic code, then with a model reviewer
— and rejected plans go back for revision until they pass or the loop runs out of
tries.

## What problem Part 5 solves

The Planner (Part 4) asks the model nicely to follow the rules: cite real evidence
ids, copy sample sizes exactly, never promise outcomes. But asking is not enforcing.
A model can write a confident, well-reading claim that is wrong: a sample size it
half-remembered, a month window outside the evidence, a "you will reach Staff" where
the evidence only says what comparable engineers typically did.

The Skeptic is the part of the system that audits the plan. It checks every claim
against the evidence ledger and sends the plan back for fixes when something does
not hold up. The pipeline is built so that a plan is never returned unchecked: the
loop audits after the last revision too, and a plan that still has problems comes
back flagged as unresolved, never silently presented as verified.

## The pipeline

`runPlan` in `src/lib/orchestrator.ts` runs the Planner once, then audits:

```text
plan (Planner draft + code-computed metrics)
  │
  ▼
AUDIT round 0 ──► layer 1: verifier (code) ──► findings? ──yes──► REVISE ──► AUDIT round 1 ...
                          │ clean                                            (same two layers,
                          ▼                                                   new words, same facts)
                    layer 2: critic (model) ──► rejections? ──yes──► REVISE ──► AUDIT round 2 ...
                          │ clean                                                       │
                          ▼                                                             ▼
                       APPROVED                                              APPROVED or UNRESOLVED
```

Up to two revisions are allowed, so there are up to three audits: the initial one
plus one after each revision. An audit passes only when both layers are clean. If
the limit is reached with problems remaining, the plan is still returned — but with
the status `"unresolved"` and the outstanding rejections attached, so the UI can
show exactly which claims did not pass.

## Layer 1: the verifier (code)

`verifyPlan` in `src/lib/skeptic/verifier.ts` is pure code, no model. It rejects
what code can _prove_ wrong about a plan by checking it against the evidence
ledger. Each problem becomes a finding with a machine-readable code; there are
thirteen:

| Code                       | What it catches                                            | Example                                                    |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `unknown_evidence`         | A claim cites an evidence id that is not in the ledger     | Citing `"ev_made_up"`                                      |
| `wrong_route_evidence`     | A claim cites another route's evidence                     | A climb claim citing the jump route's stats id             |
| `n_mismatch`               | `claim.n` matches no cited evidence's sample size          | Claim says `n=5`, evidence has `n=55`                      |
| `range_unsupported`        | `claim.range` matches neither quotable range               | Range `[1, 2]` when the evidence says `[18, 23]` and rates |
| `ungrounded_number`        | Prose quotes a number in no cited evidence                 | Summary says "7 months" but no evidence contains 7         |
| `overclaiming_language`    | Prose promises or guarantees an outcome                    | "You will reach Staff."                                    |
| `window_out_of_range`      | A step's month window falls outside `[0, upper bound]`     | Window `[20, 999]` on a route whose range ends at 30       |
| `window_order`             | A window runs backwards or starts before the previous step | `[10, 2]`; or step 2 starting at month 3 after month 10    |
| `missing_limited_evidence` | A thin route (`n < 15`) never says "limited evidence"      | A pivot on 9 twins with no such phrase                     |
| `unknown_marker`           | A step references a company marker id that does not exist  | `"m_nowhere"`                                              |
| `step_without_claim`       | A step has no evidence-backed claim                        | A step with an empty `whyItWorks` list                     |
| `metrics_mismatch`         | Route metrics disagree with the ledger                     | `evidenceN` altered to 9999 after assembly                 |
| `missing_caveat`           | The plan does not lead with the survivorship-bias caveat   | First caveat is "Be careful." instead of the required one  |

Route-level problems point at the pseudo-texts `(summary)` and `(metrics)`, and the
plan-level caveat problem at `(caveats)`. Every finding carries the route index (or
`-1` for the plan as a whole), the step index when it is inside a step, the
offending text and a plain-language reason the Planner can act on. `toRejections`
in `src/lib/skeptic/findings.ts` converts findings to the shared `Rejection`
schema with source `"verifier"`.

## How numbers in prose are checked

The rule is simple: **every number must appear in the evidence it cites.** For each
claim, the verifier gathers every number inside the cited tool results (plus the
claim's own `n` and `range`, which are checked separately), then flags any number
in the claim's text that is not in that set. Route summaries are checked against
everything in the route's own evidence.

Two details make this work in practice:

- **Percentages are matched against fractions.** Evidence stores success rates as
  fractions like `0.56`, but prose says "56%". The supported set includes the
  percentage form of every fraction between 0 and 1 (rounded to two decimals), so
  writing "56%" for a cited rate of `0.56` passes.
- **Labels are not numbers.** Band labels (`B4`), levels (`L6`), ids (`ev_12`,
  `m_fintech`), ordinals (`1st`) and times (`6pm`) have digits glued to letters, so the
  extractor skips them. "Twins reached L6 with comp in B4-B5" contains no checkable
  numbers. Thousands separators are understood (`1,000` is one thousand). These two
  rules were bugs, found by Muse Code during review and fixed in Part 5.

## Layer 2: the critic (model)

Code can check numbers and wording; it cannot judge whether advice contradicts a
person's constraints or whether a causal claim is unsupported. So once the verifier
is clean, a model reviews the plan for exactly the things code cannot see:

1. Causal claims the evidence does not support ("because", "led to", "caused").
2. Contradictions within a route or between routes.
3. Advice that conflicts with the person's constraints (e.g. relocating when
   `noRelocation` is set).
4. A route presented with no downside or trade-off at all.
5. Statements about specific companies, markets or industries the fact sheet does
   not support.
6. Anything that reads as screening or judging candidates for employers.

The critic runs only once the verifier is clean because there is no point asking a
(slower, costlier) model for subtle judgement on a plan that still has provable
mechanical errors — and because it must not waste its attention re-checking what
code already proved. Its prompt says so explicitly: numbers, evidence ids, windows
and promises are already verified; do not re-check those.

Models reviewing text can hallucinate problems, so every issue must quote the plan
verbatim, and code discards any issue whose quote cannot be found (ignoring case
and whitespace) in the route it names. A rejection from the critic therefore always
points at real words a person can read. Discarded issues are counted and reported
in the verdict notes so the trace stays honest about them. Minor observations come
back as notes, labelled by route, rather than rejections.

## The revision loop

When an audit rejects a plan, `revisePlan` in `src/lib/agents/planner.ts` asks the
Planner to fix it. The revision message lists every rejection numbered, each with
its code in brackets, where it is ("the climb route, step 2", or "the plan as a
whole"), the offending text in quotes and the problem — then instructs the model
to fix every problem, return the complete corrected JSON with all three routes,
and keep everything that was not criticised. The conversation replays the original
request and the rejected draft, so the model makes a targeted fix instead of
rewriting everything.

The fact sheet does not change during revision: only the words are rewritten, and
`assemblePlan` merges them with the same code-computed metrics again. This is what
makes "numbers never change during revision" a structural guarantee rather than a
hope — a revision can reword a claim, but it cannot move a number.

Audits happen once for the first plan and once more after each revision (up to two
revisions, so up to three audits). If problems remain after the last audit, the
run ends with status `"unresolved"`: the plan is returned together with the
outstanding rejections, and it must be presented as what it is — a plan with known
open problems — never as verified.

## Why windows are judged against the ledger

Month windows are checked against the route's upper bound taken from the ledger's
`pathStats` record — not from the route's own metrics. If the metrics were tampered
with (or corrupted), that is reported once as `metrics_mismatch` rather than
skewing every window check: judging windows against tampered metrics would either
hide the real problem or multiply one fault into many confusing rejections.

## Files

| File                               | What it does in one line                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/skeptic/verifier.ts`      | `verifyPlan()`: the deterministic layer-1 checks against the ledger.        |
| `src/lib/skeptic/critic.ts`        | `runCritic()`: the model reviewer plus the verbatim-quote guard.            |
| `src/lib/skeptic/skeptic.ts`       | `auditPlan()`: runs layer 1, then layer 2 only when layer 1 is clean.       |
| `src/lib/skeptic/findings.ts`      | `Finding`/`FindingCode` plus `toRejections()` into the shared schema.       |
| `src/lib/skeptic/textChecks.ts`    | Promise-word and number-in-prose helpers used by the verifier.              |
| `src/lib/orchestrator.ts`          | `runPlan()`: plan, audit, revise (max 2), re-audit; approved or unresolved. |
| `src/lib/agents/plannerPrompts.ts` | `revisionUserMessage()`: the fix-this list sent back to the Planner.        |

## Live results

Measured on 3 Nov 2026 against the real models, six scenarios per run
(`npm run live:audit`: backend, backend with remote and no-relocation, a thin ML pivot, a thin
embedded pivot, an engineering-manager goal, and an SRE with a low-risk preference).

| Run                            | Approved | First-pass approvals | Time per scenario              | What happened                                                                                                                                                                                                                                                   |
| ------------------------------ | -------- | -------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First (default temperature)    | 5 of 6   | 4 of 6               | 29-38 s                        | One scenario **failed outright**: both composition attempts returned unparseable JSON. One scenario got a critic rejection that was a **false positive**: the critic's fact digest omitted company types the Planner was allowed to cite. Revision resolved it. |
| Second (after the fixes below) | 6 of 6   | 5 of 6               | 21-37 s (51 s with a revision) | One **genuine verifier rejection**: a pay claim said `n=34` where its cited comp evidence has `n=53`. The Planner fixed it in one revision.                                                                                                                     |

What the first run taught us, and what changed:

- **Critic false positive:** the digest now includes everything the Planner may cite (company
  types, comp bands, marker names), and a test pins it.
- **Unparseable JSON:** see "JSON reliability" in `docs/api-notes.md` and ADR 0006. Structured calls
  now use temperature 0.3, parse errors say where the JSON broke, and a conservative recovery
  handles a stray tail.

Natural rejections are not frequent: across the 12 live scenarios, 1 verifier rejection and
1 critic rejection occurred. We deliberately do not stage them. The demo uses a recorded real run.

## Known limits

- The cohort is synthetic, so "faithful to the evidence" is not "true in the
  world". The Skeptic proves a plan says only what its evidence says; the evidence
  itself describes fictional engineers.
- The critic is a model and can miss problems (or raise ones the quote guard then
  discards). Layer 1 is exact; layer 2 is judgemental.
- Overclaim detection is a word list (`will`, `guaranteed`, `always`, ...). It ignores
  hyphenated compounds such as "will-power" or "never-ending", but it can still fire on
  other innocent uses and it cannot catch every kind of overclaim: a confident
  implication with none of the listed words sails through.

## How to verify

```bash
npm run check
```

Unit tests use the scripted mock model. One live script exercises the real thing
(run through the credentials wrapper):

```bash
npm run live:audit   # with MODEL_API_KEY and BASETEN_API_KEY exported; see .env.example
```

It runs the full pipeline — Planner, Skeptic, revisions — on real models across
several scenarios and reports how often the Skeptic rejects plans, what for,
whether revisions resolve it and how long it all takes.

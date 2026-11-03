# Part 4: Route engine and Planner agent

**Goal:** turn a person, a goal and some constraints into a three-route career plan
whose every number is computed by code and can be traced back to the evidence behind
it — with the model doing what it is good at (choosing what to look up, writing
readable prose) and code owning everything else.

## What problem Part 4 solves

A model asked to "plan my route to Staff Engineer" will happily invent statistics:
placement rates, timelines, salary bands. They read well and mean nothing. Part 4
removes the model's power to invent, while keeping its strengths. The core idea:

> Models write words; code owns every number.

Concretely: deterministic tools aggregate the synthetic cohort into evidence records
in a ledger; a fact sheet distils the records the plan needs; the model writes route
summaries and steps around that fact sheet; code merges in the metrics, the radar,
the evidence links and the survivorship caveat. There is no code path by which a
figure the model wrote can reach the final plan's metrics.

## The Planner flow

`runPlanner` in `src/lib/agents/planner.ts` runs four phases:

```text
input (profile, goal, constraints)
  │
  ▼
GATHER ── model chooses tools ──────────────────────────► ledger
  │        findTwins, pathStats, compBands via            (+ trace events)
  │        the planner executor; each call recorded
  ▼
COMPLETE ─ code fills gaps ─────────────────────────────► ledger
  │          gatherEvidence() reuses matching records,
  │          runs whatever the model skipped (by: engine)
  ▼
fact sheet (twins, 3 × route facts, survivorship, filledIn)
  │
  ├─► COMPOSE ── model writes words ──► draft (summary + steps only)
  │             around the fact sheet   (one repair retry if invalid)
  ▼
ASSEMBLE ─ code merges metrics ──► PlanResult
           assemblePlan(): words from the draft,
           EVERY number from the fact sheet
```

GATHER gives the model agency over _what to look at_: it decides which tools to
call and can even explore variants (e.g. `findTwins` with `remote: true`). COMPLETE
takes away its power to leave a gap: `gatherEvidence` checks that the evidence the
plan needs exists and runs anything missing. COMPOSE gives the model the fact sheet
and asks for words only. ASSEMBLE merges the two, taking metrics exclusively from
code.

## Who owns what

Each field of a final `Route` (and the plan's caveats) has exactly one author:

| Field          | Produced by | Notes                                                                                           |
| -------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `summary`      | Model       | One paragraph per route; must say "limited evidence" when the flag is set.                      |
| `steps`        | Model       | 2–4 moves with proof needed, gap closers and company markers.                                   |
| claims         | Model       | Each step's `whyItWorks`; must cite the route's evidence ids with the exact `n`.                |
| `monthWindow`  | Model       | Must lie within the route's `monthsToGoal` upper bound; `[0, 0]` when it is null.               |
| `metrics`      | Code        | Months, comp band, success rate and sample size, copied from the fact sheet.                    |
| `radar`        | Code        | Six 0–100 axes from `computeRadar`; the draft schema has no field for it.                       |
| `evidenceThin` | Code        | From the tool result (`n < 15`); a draft claiming otherwise is overruled.                       |
| `evidenceIds`  | Code        | The route's `pathStats` id plus the shared `compBands` id.                                      |
| `caveats`      | Both        | Code writes the survivorship caveat first; the model adds 0–2 extras (the schema caps it at 4). |

"Model" rows are still constrained: the compose prompt states the rules, draft
validation enforces the shape, and (from Part 5) the Skeptic verifies the claims.

## Files

`src/lib/engine/` — pure code over the cohort. No model, no network.

| File           | What it does in one line                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| `facts.ts`     | `gatherEvidence()`: reuse matching ledger records, fill gaps, build the sheet.   |
| `assemble.ts`  | `assemblePlan()` / `assembleRoute()`: merge a draft's words with code's numbers. |
| `drafts.ts`    | `PlanDraft`: the Zod schema of what the model may write (words only).            |
| `radar.ts`     | `computeRadar()` plus `RADAR_BASIS`, the plain-language definition of each axis. |
| `summaries.ts` | `summarizeEvidence()`: one human-readable line per tool result for the trace.    |
| `index.ts`     | Public entry point; consumers import the engine from here.                       |

`src/lib/agents/` — the Planner agent and its vocabulary.

| File                | What it does in one line                                                  |
| ------------------- | ------------------------------------------------------------------------- |
| `planner.ts`        | `runPlanner()`: the GATHER → COMPLETE → COMPOSE → ASSEMBLE flow.          |
| `plannerTools.ts`   | `PLANNER_TOOLS` plus the executor that validates and records model calls. |
| `plannerPrompts.ts` | Gather/compose system prompts and the user-message builders.              |
| `events.ts`         | `AgentEvent`, `Emit` and `noEmit`: the trace vocabulary.                  |
| `index.ts`          | Public entry point for the agents.                                        |

## Evidence reuse rules

`gatherEvidence` may be called on a ledger the model has already written to. It
reuses a record only if its arguments equal what this plan needs:

- `findTwins` matches when profile and goal are identical and the twin-matching
  knobs agree — only `remote` and `noRelocation` count; `riskTolerance`,
  `minCompBand` and the rest do not change who counts as a twin.
- `compBands` matches when level equals the goal's target level and region equals
  the person's region.
- `pathStats` matches when the archetype is the one wanted **and** the twin id
  list is exactly this plan's twin set.

Anything without a match is run by code and listed in `filledIn`, so the trace can
say who did what. An exploratory variant — say the model tried `remote: true` out
of curiosity — stays in the ledger and stays citable, but its numbers never feed
the plan's metrics, because the plan is computed from the user's real constraints.

## The model-facing tools

The Planner model does not see the internal tools directly. `PLANNER_TOOLS` is a
shaped view designed to prevent whole classes of mistake:

- `findTwins` takes no profile, goal or baseline constraints: the executor injects
  the real person's data, so the model can never retype (or subtly alter) them. It
  accepts only two optional exploration knobs, `remote` and `noRelocation`.
- `pathStats` takes `twinsEvidenceId` instead of a list of twin ids, so the model
  never has to copy ~150 ids correctly — and the result it gets back omits the id
  list for the same reason.
- `compBands` takes a level and a region, as the internal tool does.

Everything the model sends is still validated: unknown tool names, bad arguments
and evidence ids that do not belong to a `findTwins` call come back as error JSON
the model can read and correct, and every call — success or failure — is reported
to the trace with `by: "agent"`.

## Failure handling

| What goes wrong                       | What happens                                                          |
| ------------------------------------- | --------------------------------------------------------------------- |
| Model skips tools                     | COMPLETE runs the missing lookups; a note names who did what.         |
| Model sends bad arguments             | Zod rejects them; the error is returned as JSON for the model to fix. |
| Model sends an unknown evidence id    | Error JSON ("not the evidenceId of a findTwins call"); nothing runs.  |
| Model calls an unknown tool           | Error JSON naming the available tools; nothing is recorded.           |
| First draft fails validation          | One repair retry with the validation issues; then it throws.          |
| Model tries to write metrics or flags | The draft schema has no such fields, so Zod strips them.              |

## The radar

Each route gets six absolute 0–100 scores (higher is always better), computed by
`computeRadar` from the route's `pathStats` result. They are absolute, not relative
to the other routes, so a route keeps its shape when constraints change. The UI
shows the basis of each axis next to it:

| Axis        | Basis (`RADAR_BASIS`)                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `comp`      | Comp band reached: the middle of the P25-P75 comp band range among twins who reached the goal.                  |
| `speed`     | Speed: median months to goal among twins who reached it; 12 months or fewer scores 100, 60 or more scores 0.    |
| `risk`      | Odds of success (a low-risk score): midpoint of the 95% interval for the share of twins who reached the goal.   |
| `learning`  | Learning (proxy): average number of company moves among twins who reached the goal; 3 or more moves scores 100. |
| `balance`   | Work-life balance (proxy): share of twins who reached the goal while working remotely.                          |
| `stability` | Stability: share of twins who did not leave the field on this route.                                            |

Note honestly what these are: `comp`, `speed`, `risk` and `stability` come straight
from outcome data, but `learning` (moves as a stand-in for learning) and `balance`
(remote share as a stand-in for balance) are proxies the cohort lets us measure —
hence the "(proxy)" in their definitions.

## Measured: reasoning effort and speed

Reasoning effort is the Planner's speed dial: Muse Spark's hidden reasoning
dominates latency, and composing text around computed facts needs little of it. We
measured the composition call live on 3 Nov 2026 at three efforts:

| Effort  | Compose call | Whole run | First draft                              |
| ------- | ------------ | --------- | ---------------------------------------- |
| medium  | 157 s        | 174 s     | (baseline)                               |
| low     | 47 s         | 70 s      | No parseable JSON, so it needed a repair |
| minimal | 13 s         | 32 s      | Validated first time                     |

Four further runs at minimal took 19 to 42 s, and all had claims consistent with
the evidence ledger. The conclusion: for writing text around supplied facts, more
reasoning was slower and no more reliable — so compose defaults to `minimal` and
gather to `low`, overridable per phase through `PlannerDeps.reasoning`.

## Known limits

- The Skeptic — the agent that verifies claims, month windows and overclaiming
  language against the ledger — arrives in Part 5. For now the Planner only _asks_
  the model to follow those rules in the compose prompt; nothing enforces them yet.
- The cohort is synthetic: every number describes fictional engineers, so plans
  demonstrate the machinery, not real labour-market odds.

## How to verify

```bash
npm run check
```

Unit tests use the scripted mock model. Two live scripts exercise the real thing
(run through the credentials wrapper, e.g.
`npm run live:planner`, with the API key exported as in `.env.example`):

- `scripts/live-planner-check.ts` runs the Planner against the real models on a
  well-supported and a thin scenario and checks claim consistency with the ledger.
- `scripts/diagnose-planner.ts` times each call of one run and prints why the first
  draft was rejected, if it was — the tool used to tune the prompts and the
  reasoning defaults above.

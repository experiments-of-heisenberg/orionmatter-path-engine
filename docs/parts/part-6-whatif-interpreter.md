# Part 6: The What-if interpreter

**Goal:** let a person change their plan by typing a sentence. The interpreter
translates one plain-language message ("I won't relocate", "within 2 years")
into validated constraint changes — without ever letting a model write
constraints directly.

## The problem

People think in sentences; the engine runs on validated constraints. A person
says "I won't relocate" or "within 2 years", but the planner needs
`noRelocation: true` or `maxMonths: 24` — values with exact types, ranges and
meanings. Somewhere, the sentence has to become the value.

The rule of this part is: **models propose; code validates and applies.** A
model reads the sentence and proposes changes, but every proposal is checked by
deterministic code before it becomes a constraint: the quoted words must really
be in the message, the values must pass the schema, and the numbers must be in
range. A model that misreads, guesses or invents something gets overruled, with
a reason a person can read.

## The pipeline

`interpretWhatIf` in `src/lib/whatif/interpret.ts` runs six steps:

```text
INPUT          the person's text is sanitised and capped at 500 characters
  │
  ▼
MODEL          proposes changes, unsupported requests, contradictions, a question
  │
  ▼
QUOTE GUARD    anything quoting words the person never wrote is discarded
  │
  ▼
APPLY          code validates every value and builds the new constraints
  │
  ▼
EVIDENCE       the fast path recomputes with the new constraints; conflicts reported
  │
  ▼
STATUS         applied, needs_clarification, or nothing_applicable
```

The model plans nothing and knows no statistics. Its whole job is translation:
one sentence in, proposed constraint changes out. Everything after it is code.

## The six constraint fields

Only six knobs exist. The model may propose changes to these and nothing else:

| Field           | Accepted values                        | Example sentence                 | How code validates it                                                                                                                                                                                                                             |
| --------------- | -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remote`        | `true` or `false`                      | "only remote roles please"       | The schema enforces a boolean; code assigns it. A change to the value already set is noted, not reported as a change.                                                                                                                             |
| `noRelocation`  | `true` or `false`                      | "I won't relocate"               | Same as `remote`: boolean from the schema, assigned by code, no-ops noted.                                                                                                                                                                        |
| `minCompBand`   | `"B1"` to `"B5"`, or `null` to clear   | "I need at least band B4"        | The schema accepts only the five bands or null; code sets the band or deletes the key. Nothing is ever clamped.                                                                                                                                   |
| `maxMonths`     | A whole number of months, or `null`    | "I want to get there in 2 years" | Code refuses anything outside 6 to 120 months with a reason ("3 months is outside the supported range of 6 to 120 months"); `null` clears the limit.                                                                                              |
| `riskTolerance` | `"low"`, `"medium"` or `"high"`        | "I want to play it safe"         | The schema enforces one of the three; code assigns it.                                                                                                                                                                                            |
| `skills`        | `"add"` or `"remove"` plus a name list | "what if I learn Rust?"          | Each name is normalised (lower-case, trimmed) and must be one or two short words of safe characters; implausible names are refused individually, the list is capped at 5 skills, and removing a skill that is not there is refused with a reason. |

The model does the human arithmetic ("within 2 years" means 24 months) and code
checks the result: 24 is in range, so it is applied; 3 or 300 would be refused
with an explanation, not silently fixed.

## Result statuses

Every interpretation ends in one of three statuses:

- `applied`: every part of the message was understood and applied.
- `needs_clarification`: part of the message was too vague, so a question is
  returned — but the clear parts were still applied immediately.
- `nothing_applicable`: nothing in the message could be turned into a change
  (chit-chat, or a request the cohort cannot represent at all).

The middle rule matters: **clear parts of a message are applied even when
another part needs a question.** If the person writes "I want more money, but
only remote", the model must not guess a pay band — "more money" is vague — so
it asks "Which minimum pay band do you want?" with quick answers B3, B4, B5.
But "only remote" is perfectly clear, so `remote: true` is applied straight
away and the map can redraw while the interface asks the follow-up. The vague
part is never guessed; the clear part is never held back.

## Unsupported is not the same as ignored

Some requests are perfectly reasonable and simply not in the cohort data: a
4-day work week, no on-call, visa sponsorship, a particular company, industry,
city, equity, or management style. The model lists these under `unsupported`
with a short reason, and they are returned to the caller alongside whatever was
applied.

The key rule: **unsupported requests are reported, never remapped.** The prompt
forbids mapping them onto another field — "no on-call" must not quietly become
low risk tolerance, and "4-day week" must not become anything at all. A request
the data cannot represent stays visible as exactly that, so the person knows
the plan does not account for it. When the only request is unsupported ("no
on-call please"), the status is `nothing_applicable` and the constraints come
back untouched.

## Contradictions

When two parts of one message ask for opposite things, neither side is applied.
Contradictions are detected twice, independently:

1. **By the model**, which lists the fields involved and the exact phrases in
   `contradictions` and makes no change to those fields.
2. **By code**, which does not trust the model to notice: `applyChanges`
   detects opposite values proposed for one field (remote both true and false)
   and the same skill both added and removed, and blocks the whole field.

Either way the result is the same: the field keeps its old value, a
`contradiction` conflict explains what disagreed ("Neither was applied"), and
the status is `needs_clarification`. When the model flagged the contradiction
but asked no question, code builds one: the description plus "Which do you
want?", with the person's own phrases as the options.

## Evidence conflicts

After applying the changes, the interpreter recomputes the engine's fast path
with the new constraints and checks the result against the evidence. A
constraint can be perfectly well-formed and still leave the person with
nothing — "Staff in 6 months" when no comparable engineer ever did it that
fast. There are three kinds of conflict:

| Kind            | Exact condition                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contradiction` | The message asked for opposite things (flagged by the model or detected by code). Neither side was applied.                                                                                                 |
| `infeasible`    | Zero comparable engineers match the new constraints; or `maxMonths` is strictly below the fastest route's typical start (`monthsToGoal[0]`); or `minCompBand` is above the top of every route's comp range. |
| `thin_evidence` | The new constraints leave between 1 and 14 comparable engineers (fewer than the engine's threshold of 15), so every route rests on limited evidence.                                                        |

Conflicts **never block**: the constraints are applied anyway and the conflict
is reported with numbers ("No route's typical timeline fits within 6 months.
The fastest comparable engineers (the jump route) took 18 to 23 months"). The
person decides; the interpreter makes sure nobody is surprised by an empty map.

## Untrusted input and the guards

The person's message, the history, and everything the model returns are all
untrusted. Six guards stand between them and the constraints:

1. **Sanitising.** Control characters are stripped (newlines and tabs survive)
   and surrounding whitespace is trimmed before the model sees anything.
2. **The length cap.** A What-if request is a sentence, not an essay: messages
   over 500 characters are rejected with `WhatIfInputError`, as are empty
   ones. History is trimmed to the last three turns.
3. **The quote guard.** Every change carries a `phrase` — words copied from the
   person's message. Code checks each phrase appears in what the person wrote
   (ignoring case and whitespace) and discards anything quoting words that were
   never said, counting the discards in the notes. Quotes may come from the
   person's earlier answers, but never from the assistant's own question: a
   phrase found only in "Which band? B1 is lowest, B5 highest" does not count.
4. **Schema validation.** The model's whole output is parsed against the
   `ModelOutput` schema (at most 8 changes, 5 unsupported items, 3
   contradictions, an explicit clarification or null). A tricked model that
   proposes band B9 fails validation and gets one repair retry, not a
   constraint.
5. **Value validation.** Ranges are checked in code so failures become
   explanations: 3 months is "outside the supported range of 6 to 120 months",
   not a silent clamp to 6.
6. **The skill-name rule.** A skill is one or two short words ("rust",
   "machine learning", "c++"). Anything longer or with unusual characters is
   refused, so a sentence-like injection string can never become a "skill".

## Files

| File                          | What it does in one line                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/whatif/schemas.ts`   | `ModelOutput` (what the model returns) and `Interpretation` (what code returns).     |
| `src/lib/whatif/prompts.ts`   | The system prompt's rules and worked examples, plus the user-message builder.        |
| `src/lib/whatif/interpret.ts` | `interpretWhatIf()`: the six-step pipeline from sentence to validated constraints.   |
| `src/lib/whatif/apply.ts`     | `applyChanges()`: the quote guard, value checks, and code-side contradiction checks. |
| `src/lib/whatif/conflicts.ts` | `evidenceConflicts()`: infeasible and thin-evidence checks against the fact sheet.   |
| `src/lib/whatif/index.ts`     | The public entry point re-exporting the module's functions and constants.            |
| `evals/whatif/cases.ts`       | Labeled utterances saying what a correct interpretation looks like.                  |
| `evals/whatif/check.ts`       | The offline matcher comparing an interpretation with its expectation.                |

## Live evaluation

Results of the live evaluation are added by the maintainer after measurement.

## Known limits

- Only six knobs exist. Anything else a person asks for — hours, on-call, visa,
  company, city — is reported as unsupported, never approximated.
- Four of the six knobs do not yet change the route numbers. To state this
  plainly: today `remote` and `noRelocation` change who counts as a comparable
  engineer, while `minCompBand`, `maxMonths`, `riskTolerance` and `addSkills`
  are recorded and checked for conflicts but do not yet change the route
  numbers. Part 7 addresses this.
- The interpreter is a model and can misread an unusual sentence. The guards
  above catch invented quotes and invalid values, but a sentence read the wrong
  way with the right words still applies the wrong change.
- English only. Skill names, band labels and the quote guard all assume English
  input.

## How to verify

```bash
npm run check
```

Unit tests use the scripted mock model. One live script exercises the real
thing across the labeled cases in `evals/whatif/cases.ts`:

```bash
npm run live:whatif   # with MODEL_API_KEY and BASETEN_API_KEY exported; see .env.example
```

It reports the per-category pass rate, the failures with reasons, and latency.

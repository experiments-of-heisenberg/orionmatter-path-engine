# Part 10: The Privacy Guard

**Goal:** answer "if I share this career story, how easily could someone work out who I
am?" — with code counting the crowd and deciding the risk, and the model only pointing at
details in the person's own words.

## The problem

People want to share a career story — a post, a trail card — without being identifiable.
Two different things can give someone away:

1. **The combination of attributes**: role, level, goal, region, company type. Each fact on
   its own is ordinary, but together they can narrow the field to a handful of people.
2. **The details in the free text**: names, employers, projects, exact dates, exact pay —
   specific strings someone could search for.

The Guard checks both halves and returns a risk level, plain-language reasons, and a
generalised preview of the text with the identifying details replaced.

## The pipeline

```
profile + goal ──> LADDER (code) ────────────────────────────────────┐
                                                                     ├─> VERDICT (code) ─> PREVIEW (code)
story text ──> DETECTORS (code) ──> MODEL proposes ──> GUARD ────────┘
```

- **LADDER (code)** counts how many comparable engineers in the cohort still match as each
  attribute is shared. No model involved.
- **DETECTORS (code)** find contact details, exact dates and exact pay figures by pattern.
- **MODEL proposes**: Muse Spark reads the text (with contact details already removed) and
  proposes other identifying details, each quoting the person's exact words.
- **GUARD**: code keeps a proposed finding only if its quote really appears in the text.
- **VERDICT (code)** decides the risk level and writes the reasons.
- **PREVIEW (code)** replaces every finding with a fixed placeholder for its category.

## The disclosure ladder

Start with one attribute and add the next, counting each time how many comparable engineers
still match. The crowd can only shrink, so the ladder shows exactly where a person stops
being one of many. The numbers below are real, computed by running the code for the sample
engineer (backend, L5, goal L6, IN-south):

| Shared so far                  | Crowd |
| ------------------------------ | ----: |
| backend                        |   197 |
| backend, L5                    |    93 |
| backend, L5, goal L6           |    68 |
| backend, L5, goal L6, IN-south |    11 |

Adding company type "robotics" drops the crowd to **4**.

**k = 10** is the default size of crowd a person should stay hidden in. Each rung passes
when its crowd is at least k. Two derived answers come out of the ladder:

- **"Shareable up to"**: the last rung that still passes — what could be shared safely.
  With "robotics" added, that is "backend, L5, goal L6, IN-south" (11 engineers).
- **"Drop to reach k"**: the attributes to leave out, in order, to get back to a crowd of
  k. With "robotics" added, that is `["region"]`: dropping the region leaves a crowd of 10
  or more.

The cohort only has engineers who started at L4 or L5, so a level anything else (L3, L6,
L7) cannot be counted exactly: it is left out of the ladder and a note says so, warning
that the real crowd is smaller than shown.

## The code detectors

Contact details, exact dates and exact pay follow fixed patterns, so code finds them —
always the same way — and they are never sent to the model to be judged.

| Detector        | Recognises                                                                                                                               | Example                                                | Does NOT catch (honest gaps)                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Contact details | Email addresses, phone numbers, links                                                                                                    | `jo@x.com`, `+1 415 555 0134`, `https://github.com/jo` | `@handles` without a domain; IPv4 addresses (deliberately excluded); short digit runs; year ranges like `2019-2023`  |
| Exact dates     | Numeric `2023-03-15`, `2023/03/15`, `15/03/2023`, `03-15-2023`; `March 3rd, 2024`; `3rd March 2024` (abbreviations and ordinals allowed) | `2023-03-15`, `4 June 2022`                            | Month-and-year (`March 2023`) by design; dates without a year; dates written in words other than English month names |
| Exact pay       | A currency symbol (`$ € £ ₹`) with an amount, or an amount with a unit (`LPA`, `USD`, `EUR`, `GBP`, `INR`)                               | `$180k`, `₹45,00,000`, `45 LPA`                        | Bare numbers (`180`, `180k`) with no symbol or unit; amounts in words; other currencies                              |

Two behaviours worth stating plainly: dates get no calendar validation, so the impossible
`1999-13-45` is flagged as an exact date; and any amount with a unit counts (in any letter case), so
`3 USD` is flagged even though it is hardly a salary.

## The model's half

Muse Spark is asked to find what patterns cannot: names, employers, projects and the other
specific, searchable details. It may report ten categories — everything except
`contact_detail`, which the schema forbids because code already handles those:

`person_name`, `employer`, `project_or_product`, `school`, `location_detail`,
`small_team_detail`, `unique_achievement`, `exact_date`, `exact_compensation`, `other`.

It is told **not** to flag generic words — a role ("backend engineer"), a level ("L5"), a
skill ("Go", "Kubernetes"), a broad region ("India", "Europe"), a plain duration ("seven
years") — and to leave out anything it is unsure about. The text is labelled as data, and
instructions inside it (for example to call the story safe) are to be ignored.

The **guard** then checks every proposal, and a finding is kept only if:

- its quote appears in the text as whole words (case and spacing ignored) — otherwise it
  is discarded and counted in a note;
- it is not a word the profile already shares (role, level, region, stack) — otherwise it
  is ignored with a note;
- it is not something code already found — otherwise the code finding stands, once.

**Degraded mode:** when the model is unavailable, its output is invalid (even after one
repair retry), or the caller passes `useModel: false`, the Guard still returns the ladder,
the code detectors and a preview, and says the text check was code-only. With `useModel:
false` nothing is sent anywhere.

## The risk rules

Code decides the risk from the ladder and the findings. The model never does.

| Risk       | Rule                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| **high**   | The text has contact details, or names a person, or the full crowd is below 3 |
| **medium** | The full ladder does not pass k, or there is any finding                      |
| **low**    | None of the above                                                             |

The reasons, in order (contact, person, crowd, details), using the exact texts:

- `Your text contains contact details that point straight at you.`
- `Your text names a person.`
- `Only {n} comparable engineer(s) in the data share everything you would share.` (crowd below 3)
- `Only {n} comparable engineers share everything you would share; a crowd of {k} or more is safer.` (below k but not tiny)
- `{n} detail(s) in your text could identify you or someone else.`
- Low risk adds: `The crowd stays at {n} or more and nothing in the text stood out.`

## The preview

The generalised text replaces every finding with a fixed placeholder for its category —
written in the code, never the model's words — longest quote first so `Acme Robotics` wins
over `Acme`:

| Category           | Placeholder                |
| ------------------ | -------------------------- |
| contact_detail     | `[contact detail removed]` |
| exact_date         | `[a date]`                 |
| exact_compensation | `[a pay figure]`           |
| person_name        | `[a person]`               |
| employer           | `[a company]`              |
| project_or_product | `[a project]`              |
| school             | `[a school]`               |
| location_detail    | `[a place]`                |
| small_team_detail  | `[a team detail]`          |
| unique_achievement | `[an achievement]`         |
| other              | `[a detail]`               |

## Honesty

- The cohort is **synthetic** (484 generated career histories), so the ladder demonstrates
  the method on this dataset. It is not a statement about how unique anyone is in the real world.
- The model **reads the person's text on the Meta Model API** — say so plainly to users.
  Contact details are removed locally before anything is sent, but names, employers and
  every other detail in the story are sent for review.
- There is no claim of on-device or open-weights processing for the text check.

## Files

| File                           | What it does                                                             |
| ------------------------------ | ------------------------------------------------------------------------ |
| `src/lib/privacy/assess.ts`    | The Guard itself: ladder, detectors, model call, guard, verdict, preview |
| `src/lib/privacy/ladder.ts`    | The disclosure ladder over the deterministic k-anonymity tool            |
| `src/lib/privacy/detectors.ts` | Code patterns for contact details, exact dates and exact pay             |
| `src/lib/privacy/preview.ts`   | Fixed placeholders and whole-word replacement                            |
| `src/lib/privacy/prompts.ts`   | What the model is told: quotes, categories, reasons, and the rules       |
| `src/lib/privacy/schemas.ts`   | Finding categories, the model output contract, the assessment shape      |
| `src/lib/privacy/index.ts`     | Public entry point                                                       |
| `evals/privacy/cases.ts`       | Labeled stories: what a good reviewer must and must not flag             |
| `evals/privacy/check.ts`       | Offline judge comparing an assessment with a case's expectations         |

## Live evaluation

Measured on 3 Nov 2026 against the real model (`npm run live:privacy`): 9 labeled stories in three
categories, each run three times (27 runs). The checks judge only the model's half; the ladder and the
detectors are deterministic and pinned by tests.

| Category                                                                                                                                          | Passed       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Identifying details the reviewer must point at: names, employer, project, school, small-team detail, an open-source project, a street (5 stories) | 15 of 15     |
| Generic stories it must leave alone: a role, a level, skills, a broad region, a duration (2 stories)                                              | 6 of 6       |
| Safety: a story telling the reviewer to say it is safe, and one telling it not to flag names (2 stories)                                          | 6 of 6       |
| **Overall**                                                                                                                                       | **27 of 27** |

Latency had a median of about 2.4 s and a p90 of 4.4 s. On the "generic" stories the reviewer flagged
nothing, so it is not noise; on the injection stories it still flagged the employer and the named person,
and code, not the model, set the risk level.

After the review fixes below, the evaluation was run again (2 repeats, 18 runs): 18 of 18 passed.

What review found along the way, all fixed with mutation-checked regression tests:

- **Placeholder corruption (Muse Code's bug hunt):** replacements ran one after another, so a short quote
  such as "company" or "a" could match inside a placeholder inserted for another finding and produce
  `[a [a detail]]`. The preview now finds every match on the original text and splices them in one pass.
- **An invalid `k`:** `k = NaN` produced a contradictory ladder and `k = 0` or a negative `k` silently
  passed everything. `k` must now be a whole number of at least 1.
- **Detector gaps:** numeric dates (`15/03/2023`, `03-15-2023`, `2023/03/15`) and lower-case currency codes
  were missed, and a reason read "A email address".
- **A pay figure swallowing a full stop** (found by my own test): the amount pattern now ends on a digit.

## Known limits

- English only.
- The exact-match ladder uses only starting levels L4 and L5; other levels are left out
  with a note.
- Amounts without a symbol or unit (a bare `180k`) are not flagged: `10k users` would be a false alarm.
- `k` must be a whole number of at least 1; anything else is refused with a clear error.
- Names are found only by the model.
- The model can miss a detail.
- A story can identify someone through its overall shape even with every detail removed.

## How to verify

```bash
npm run check
npm run live:privacy
```

`npm run check` runs the typechecker, linter, format check, the full offline test suite
(including the edge tests) and the secret scan. `npm run live:privacy` runs the labeled
cases against the real model and needs the API key exported (see `.env.example`).

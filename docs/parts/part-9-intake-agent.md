# Part 9: The Intake agent

**Goal:** turn a person's own words (pasted text) or a screenshot into a DRAFT profile the
engine can plan from, with code checking every field and the person confirming the result.

## The problem

People describe themselves in sentences ("I'm a backend engineer, L5, with 7 years of
experience in Bangalore") or a screenshot, but the engine needs a validated profile: a role
family, a level on one ladder, years of experience, a region, and optionally a stack,
milestones and a goal. Intake bridges that gap in three steps: the model reads, code checks,
the person confirms. The model proposes each field together with the words it read it from;
`validateReading` accepts a value only when the quote really appears in what the person
wrote and the value passes the rule for that field; anything missing becomes a plain
question instead of a guess. Nothing it produces is verified: the result carries
`verified: false`, and the interface must show the draft for the person to confirm or
correct before any plan is made.

## The pipeline

```
INPUT  ->  REDACT  ->  MODEL reads  ->  VALIDATE  ->  MERGE  ->  RESULT
```

- **INPUT**: pasted text is sanitised (control characters stripped) and capped at 6000
  characters; an image data URL goes through the image checks first. Empty input is refused
  before any model call.
- **REDACT**: emails, phone numbers and links are replaced with placeholders locally, so the
  model never sees them.
- **MODEL reads**: the model copies facts into JSON, each value with a `quote` of the exact
  words it came from (at most 200 characters), or null when something is not stated.
- **VALIDATE**: code decides each field (see the table below). Refused values land in
  `discarded` with a reason.
- **MERGE**: the new reading is merged over earlier turns (see Multi-turn).
- **RESULT**: the draft, where each field came from (`provenance`), what is missing, the
  questions to ask, warnings, redaction counts, and `verified: false`.

## Every field

For text input, every field needs its quote to appear in what the person wrote (whole words,
case-insensitive). For images the quote cannot be checked, so the value is accepted on its
own merits and marked as from an image.

| Field             | What the model returns                                                            | The exact rule code applies                                                                                                                                                                                    | One refusal, with its message                                                                        |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `roleFamily`      | A label (`backend`, `platform`, `ml`, `frontend`, `embedded`, `sre`) with a quote | The quote must be in the text                                                                                                                                                                                  | `roleFamily: the quoted words are not in what you wrote.`                                            |
| `level`           | A ladder label with a quote, or a company plus a title                            | A literal label is upper-cased, must be on the ladder, and must appear in its own quote; otherwise the company and title are looked up in the level table (ignoring case and spaces) with both quotes grounded | `level: "L9" is not on the level ladder (L3, L4, L5, L6, L7, EM1, EM2).`                             |
| `yearsExperience` | A number with a quote                                                             | Finite, 0 to 40; the quote must state that number, as digits or a number word (`one` to `twenty`, `thirty`, `forty`, and compounds such as `twenty-one` or `thirty five`); never worked out from dates         | `yearsExperience: the quote does not state 8 years; a number worked out from dates is not used.`     |
| `region`          | A region with a quote naming the place                                            | The value, trimmed, must match a covered region case-insensitively (`EU-west`, `IN-south`, `SEA`, `US-east`, `US-west`)                                                                                        | `region: "Johannesburg" is not a region the data covers (EU-west, IN-south, SEA, US-east, US-west).` |
| `compBand`        | A band label with a quote                                                         | Upper-cased, must be `B1` to `B5`, and the quote itself must contain that band                                                                                                                                 | `compBand: the text does not state that band.`                                                       |
| `stack`           | Up to 30 skill names as written                                                   | Each is normalised (lower-case, at most 24 characters, letters/digits plus `+#.-`, at least one letter, at most two words, no instruction words), must appear in the text, kept once, at most 15               | `stack: "rust" is not in what you wrote.`                                                            |
| `milestones`      | `{type, quarter, note, quote}` items                                              | The quarter must be `YYYY-Q1` to `YYYY-Q4`, the quote grounded and containing the year; at most 20; `verified` is always false                                                                                 | `milestones: the quote does not mention 2021.`                                                       |
| `goal`            | `{targetLevel, label, quote}` or null                                             | The target, upper-cased, must be on the ladder; the label is trimmed to 60 characters, falling back to the level when empty                                                                                    | `goal: "L99" is not on the level ladder.`                                                            |

Refusal messages never embed more than 30 characters of the model's raw value, so a huge
hostile string cannot flood the response.

## When Intake asks instead of guessing

The four required fields (`roleFamily`, `level`, `yearsExperience`, `region`) each have one
plain question, asked in that order. The labeled cases in `evals/intake/cases.ts` pin down
the restraint: the right answer is often to leave a field empty. Five real examples:

- A title like "senior engineer" is not a level: "I'm a senior backend engineer with 9 years
  of experience in San Francisco." fills role, years and region, but `level` stays absent.
- A company the level table does not know: "Staff Engineer at Zorgle Corp, backend, 12
  years, in Austin." cannot be mapped to a level without guessing, so `level` stays absent.
- "Since 2018" is not years of experience: "Since 2018 I have been writing firmware for
  robots. I'm an L5 in Munich." leaves `yearsExperience` absent (the quote does not state a
  number).
- A salary is not a pay band: "Backend engineer, L5, 7 years, US-east, and I earn $180k a
  year." leaves `compBand` absent (and is still complete, since the band is optional).
- An unknown region: "Backend engineer, L5, 7 years, working from Johannesburg." leaves
  `region` absent, because the data covers only five regions.

## The level table

Titles differ between companies, so `data/level-map.json` maps each known employer's titles
to the canonical ladder (`L3`, `L4`, `L5`, `L6`, `L7`, `EM1`, `EM2`). The model copies the
company and title as written; code does the mapping. The real table:

| Company          | Titles (lowest to highest)                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| BigTech A        | SDE I (L3), SDE II (L4), Senior SDE (L5), Principal (L6), Senior Principal (L7)   |
| BigTech B        | E3 (L3), E4 (L4), E5 (L5), E6 (L6), E7 (L7)                                       |
| Series C Fintech | Engineer (L3), Software Engineer II (L4), Senior (L5), Staff (L6), Principal (L7) |
| Growth Startup   | Engineer (L4), Senior (L5), Staff (L6), Lead (L6)                                 |
| Robotics Startup | Engineer (L3), Senior (L5), Staff (L6)                                            |
| Infra Scaleup    | SWE (L3), SWE II (L4), Senior SWE (L5), Staff SWE (L6), Senior Staff (L7)         |

Note that the same title can mean different levels: "Engineer" is L3 at Series C Fintech
but L4 at Growth Startup, and "Principal" is L6 at BigTech A but L7 at Series C Fintech.
That is why a title alone is never enough, and why a title from one company's table is
refused for another company.

## Images

An uploaded image is checked by `validateImage` before it is sent anywhere: the data URL
must be PNG, JPEG or WebP with valid base64; the real format is sniffed from the first
bytes and must match the label; the file must be at most 4 MB; and a PNG must be at least
64 pixels on each side, below which both models were measured to misread images.

What is not possible matters more. The quote behind an image reading cannot be verified
against the person's words, so every field read from an image is marked with source
`"image"` and the person must confirm each one. Names and contact details inside an image
cannot be removed, so the result warns the person to crop those out before uploading. There
is one image per call; when text and an image arrive together they are read in two model
calls, and the image's values win over the text's.

## Privacy

Redaction (`redact.ts`) replaces email addresses, phone numbers and links with placeholders
on our side, and the text sent to the model is the redacted text: quotes are even checked
against the redacted text, since that is all the model saw. The result says how many of
each were removed. What it does not do: names and employers remain in the text, images are
not redacted at all, and anything unusual (an ID number shaped like a phone number) may be
removed or missed. The interface says names and employers are not removed, and the Privacy
Guard in Part 10 is the second layer: it judges what the wider data could reveal.

## Untrusted input

Everything the person wrote, and everything the model returned, is treated as untrusted:

- The quote guard: a value counts only when its quote appears in the person's words
  (whole words, so "go" does not match "goal").
- Enumerated values: role family, level ladder, regions and pay bands come from fixed lists.
- Ranges and shapes: years are 0 to 40, quarters are `YYYY-Q1..Q4`, goal labels are capped
  at 60 characters, skill names must look like skills.
- Instructions hidden in text or images are data: the person's text travels inside a
  `<person_text>` block the system prompt declares to be data, and skill-shaped injections
  ("ignore previous rules") hit a second wall of refused instruction words.

## Multi-turn

A follow-up answer merges over the earlier draft: for single-value fields the newer reading
wins, a null never erases an earlier value, and the stack and milestones combine without
repeats (capped at 15 and 20). Earlier provenance is relabelled `"earlier"`, except
`"mapped"` levels, which keep saying how they were derived. A short example from the eval
cases: the first turn "I'm a backend engineer, L5." leaves years and region missing, the
follow-up "I have 9 years of experience and I work in Singapore." fills them, and the
merged draft is complete.

## Honesty rules

- `verified` is always false, and every milestone keeps `verified: false` (the shared
  Profile schema enforces the literal).
- Nothing is guessed: unstated fields are null, missing required fields become questions,
  and refused values are listed in `discarded` with reasons.
- Coverage warnings, all written by code in `warningsFor`: a goal the data has no
  engineers for ("The data has no engineers who reached L7; it covers EM1 and L6, so a plan
  for that goal would have no evidence."); no comparable engineers at all; or fewer than 15
  ("Only 11 comparable engineers match this profile and goal, so every route would rest on
  limited evidence.").

## Files

| File                         | What it does                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/intake/intake.ts`   | `runIntake()`: sanitise, redact, read, validate, merge, and report what is missing.      |
| `src/lib/intake/validate.ts` | `validateReading()`: code-side guards that accept or refuse each proposed field.         |
| `src/lib/intake/redact.ts`   | `redactPii()`: replace emails, phones and links with placeholders before any model call. |
| `src/lib/intake/image.ts`    | `validateImage()`: format, size and dimension checks for uploaded images.                |
| `src/lib/intake/prompts.ts`  | The system prompt and messages telling the model to copy, never infer.                   |
| `src/lib/intake/schemas.ts`  | `IntakeModelOutput`, `Draft`, `Provenance` and `IntakeResult` shapes.                    |
| `src/lib/intake/index.ts`    | The public entry point re-exporting the module's functions and constants.                |
| `evals/intake/cases.ts`      | Labeled inputs saying what a correct (often restrained) reading looks like.              |
| `evals/intake/check.ts`      | The offline matcher comparing an Intake result with its expectation.                     |

## Live evaluation

Measured on 3 Nov 2026 against the real model (`npm run live:intake`): 18 labeled cases in five
categories, each run three times (54 runs), plus one rendered resume screenshot.

| Category                                                                                                                     | Passed       |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Complete readings (6 cases)                                                                                                  | 18 of 18     |
| Restraint: a title is not a level, an unknown company, years from dates, a salary is not a band, an unknown region (5 cases) | 14 of 15     |
| Partial or nothing to read (2 cases)                                                                                         | 6 of 6       |
| Safety: instructions hidden in the text, an instruction-like skill, personal identifiers (3 cases)                           | 9 of 9       |
| Follow-up turns that fill gaps or correct an earlier answer (2 cases)                                                        | 6 of 6       |
| **Overall**                                                                                                                  | **53 of 54** |

Latency per call had a median of about 4.4 s and a p90 of 7.7 s. The one miss left the role family
empty for "writing firmware for robots", which is the safe direction: the person is asked instead.
No run filled in a level from a bare title, a number of years from a date, or a pay band from a
salary, and none let an instruction-like string reach the stack.

The screenshot, a rendered resume with an email and phone number printed on it, was read correctly:
backend, level L5 (mapped from "Senior SDE" at "BigTech A" through the level table), 8 years,
IN-south, four skills and a Q2 2022 promotion. Every field was marked as read from an image or
mapped. The model did see the printed email and phone number, since a screenshot cannot be redacted;
that is why the interface must tell people to crop them out.

After the review fixes below, the evaluation was run again (2 repeats, 36 runs): 36 of 36 passed.

What review found along the way, all fixed with mutation-checked regression tests:

- **Redaction bugs (Muse Code's bug hunt):** an email inside a link left stray text and wrong counts;
  an IPv4 address was removed as a phone number; a link swallowed a closing bracket; a phone number
  in brackets left its opening bracket behind.
- **A size check that could be skipped:** a PNG shorter than 24 bytes bypassed the 64-pixel check.
- **State aliasing:** merging turns shared the goal and milestone objects with the caller's state.
- **A false refusal:** "twenty-one years" was refused because only single number words were read.
- **A weak skill rule:** "123" was accepted as a skill; a skill now needs a letter.

## Known limits

- English only.
- A title the table does not know cannot become a level; neither can a bare seniority word
  without a company.
- A city outside the examples may not map to a region the data covers.
- One image per call; images are not redacted.
- The model can still misread an unusual layout, which is why every field needs confirming.

## How to verify

```bash
npm run check
npm run live:intake
```

The live evaluation runs the labeled cases against the real model and needs the API key
exported (see `.env.example`); set `REPEAT=3` to check consistency.

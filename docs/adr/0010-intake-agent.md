# ADR 0010: Intake reads, code decides, the person confirms

- Status: accepted
- Date: 2026-11-03

## Context

People describe their career in a sentence, a pasted bio or a screenshot. The engine needs a validated
profile. A model can read, but a model that "helpfully" fills gaps would put invented facts (a level,
years of experience, a pay band) at the root of a career plan.

## Decision

1. **The model copies; code accepts.** Each field comes back with the words it was read from. Code
   accepts a value only if those words are in what the person wrote (whole words), the value agrees
   with them, and it is on an allowed list and in range.
2. **Ask, don't guess.** A job title is not a level (ladders differ by company), so a level is
   accepted only if the label itself is quoted or the company and title are in the level table.
   Years of experience must be a number the text states: "since 2018" never becomes "8 years", and a
   salary never becomes a pay band. Missing required fields become plain questions.
3. **Nothing is verified.** The result carries `verified: false`, every milestone stays unverified, and
   the interface must show the draft for the person to confirm.
4. **Redact before reading.** Emails, phone numbers and links are removed from text locally before the
   model sees it. This is best effort: names and employers remain, and we say so. The Privacy Guard
   (Part 10) is the second layer.
5. **Images are different, and we say so.** An image cannot be quote-checked, so its fields are marked
   "image" for confirmation, and we cannot remove names inside it, so we warn the person to crop them.
   Images are validated by their real bytes, size and (PNG) 64-pixel minimum before being sent.
6. **Merge across turns.** A follow-up answer fills gaps and corrects earlier fields; lists combine.
7. **Evaluate on hard cases.** 18 labeled cases, most of them about restraint and safety, with an
   offline-tested matcher.

## Consequences

- Positive: a misreading or an injection in the text cannot invent a profile field; every field shows
  where it came from; the live evaluation passed 53 of 54 runs, and the one miss was the model
  leaving a field empty, which is the safe direction.
- Negative: stricter than a human reader. "Senior engineer" always triggers a question, and a
  city the prompt does not list may not map to a region. We accept the extra question.
- Negative: image-read fields rest on the model's reading alone, which is why they need confirmation.

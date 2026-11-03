# ADR 0006: Making structured model output reliable

- Status: accepted
- Date: 2026-11-03

## Context

Live runs showed Muse Spark sometimes returns JSON that is almost valid: junk tokens after a
complete document, or one misplaced brace. At default temperature about 18% of Planner
composition replies failed to parse. A failed parse costs a repair call (about 15 s) and, in
one live scenario, both attempts failed and the run aborted. Neither model has a reliable JSON
mode (Muse Spark Open officially has none), so we cannot lean on one.

## Decision

1. **Lower the temperature for structured calls.** `chatStructured` defaults to 0.3
   (`STRUCTURED_TEMPERATURE`) unless the caller overrides it. Measured: 3 of 50 failures versus
   9 of 50 at the default. Free-text calls keep the provider default, as Meta recommends.
2. **Tell the model where its JSON broke.** Parse errors report the reason and character
   position, never the text itself (V8 messages embed snippets, which could leak model output or
   user data into logs and prompts).
3. **Recover conservatively from a stray tail.** If a reply is complete except for a short
   (at most 40 characters) tail with no quotes, colons or opening brackets, and at most three
   brackets are missing, close it and parse. Never when the provider reported
   `finish_reason: "length"`. The result is always schema-validated, and `recovered` is
   reported so the trace stays honest.
4. **Do not "fix" structural slips mid-document** (the misplaced brace). Guessing the intent is
   unsafe; those go to the one repair retry.
5. **Keep real failing replies as regression fixtures** (`tests/fixtures/model-replies/`).

## Consequences

- Positive: far fewer repair calls (1 of 20 runs versus 4 of 20), faster and more predictable runs.
- Positive: nothing silently papers over missing data; recovery is narrow, reported and validated.
- Negative: a lower temperature departs from Meta's default guidance. The evidence is
  suggestive rather than conclusive, so this should be re-measured if the models change.
- Negative: the recovery heuristics add code that must stay tightly tested.

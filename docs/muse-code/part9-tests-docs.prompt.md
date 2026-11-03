# Task: extra tests, a bug hunt and a docs page for Part 9, the Intake agent (tests and docs only)

Read AGENTS.md first and follow it. Part 9 added src/lib/intake/: an agent that turns a person's own words (pasted text)
or a screenshot into a DRAFT profile. It is implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION.
You must NOT change any file under src/, evals/ or scripts/.

## Read first (do not edit)
src/lib/intake/*.ts, and the existing tests/intakeCore.test.ts, tests/intakeEvalMatcher.test.ts, evals/intake/cases.ts,
src/lib/whatif/apply.ts (phraseInText, normalizeSkill), src/lib/tools/levelMap.ts, data/level-map.json, src/lib/model/mock.ts.
Do NOT duplicate what the existing tests cover; add what is missing.

## Create these test files (Vitest, deterministic, offline, no live API)

1. tests/intakeRedactEdges.test.ts for src/lib/intake/redact.ts
   - emails: plus-addressing, subdomains, uppercase, adjacent punctuation, two emails in one line, an "@" handle without a domain (not an email).
   - links: http, https, www., linkedin.com/in/x, github.com/x, a link followed by a full stop, comma, closing bracket, question mark (the punctuation must stay in the text).
   - phones: international +44 7911 123456, (415) 555-0134, 415-555-0134, 415.555.0134, 09876543210; NOT phones: a four-digit year, "2019-2023", "12 3456" (too short), a version like "1.2.3.4", an ISO date "2024-03-15".
     For each non-phone case state what the function does today (read the code) and assert that; if something that is plainly not a phone number is removed, or a phone number is NOT removed, that is a bug: report it.
   - the order of replacement: an email inside a link ("https://x.com/a@b.com") is counted once, in a sensible way; state what happens.
   - counts match the number of placeholders in the output text; idempotence: redacting twice changes nothing the second time.
   - an empty string and a string of only whitespace.

2. tests/intakeValidateEdges.test.ts for src/lib/intake/validate.ts (use validateReading with hand-built readings)
   - quote guard uses whole words: a quote "go" does not ground "I want to reach my goal".
   - level: lower-case label "l5" in value and quote is accepted and upper-cased; "EM1" and "EM2" accepted; "l 5" and "L05" refused.
   - company/title mapping: each system in data/level-map.json (read the file in the test) maps each of its titles to the level the table says, ignoring case and extra spaces; a title that exists in a different company's table is refused for the wrong company.
   - when BOTH a literal level and a company/title are given and the literal level is refused, mapping still applies; when the literal level is accepted, mapping is skipped (so the literal wins). Verify by reading the code.
   - years: 0 accepted; 40 accepted; 40.5 accepted? (read the code and state what happens, and whether a fractional "2.5 years" works); NaN and Infinity refused; "twenty years" accepted as 20; "21 years" with a quote saying "twenty-one" (read the code: NUMBER_WORDS has no twenty-one; state what happens and report it as a doubt if it is a false refusal).
   - region: case-insensitive match returns the canonical spelling; whitespace around the value; empty string.
   - stack: duplicates in different case collapse; a skill with "+", "#" and "." ("c++", "c#", "node.js") is kept; a numeric-only item ("123") behaviour (read normalizeSkill and state it); exactly 15 kept with 16 given.
   - milestones: the 20 limit; the same quarter in two different milestones both kept; a quote naming a different year than the quarter is refused.
   - goal: label longer than 60 characters is trimmed to 60; an empty label falls back to the level.
   - discarded messages never contain more than 30 characters of the model's raw value (look for slice calls) so a huge hostile string cannot flood the response.

3. tests/intakeImageEdges.test.ts for src/lib/intake/image.ts
   - JPEG magic bytes accepted with the right label; WebP (RIFF....WEBP) accepted; a WebP labelled PNG refused; GIF refused; SVG data URL refused.
   - base64 with invalid characters refused; a data URL without the base64 marker refused; uppercase "DATA:" prefix (state what happens).
   - the size cap boundary: an image of exactly MAX_IMAGE_BYTES bytes is accepted (a PNG with a valid header padded with zeros) and one byte more refused.
   - PNG dimensions: exactly 64x64 accepted; 63x64 and 64x63 refused; a truncated PNG shorter than 24 bytes (what happens? read the code and state it).
   - the error is an instance of IntakeImageError and of Error, with name "IntakeImageError".

4. tests/intakeMergeEdges.test.ts for the merge and status logic in src/lib/intake/intake.ts via runIntake with the mock model
   - a new reading never erases an earlier field when it says null for it.
   - the same stack skill in two turns appears once; the 15 stack limit holds across turns; the 20 milestone limit holds across turns; the same milestone twice appears once.
   - provenance: earlier fields get source "earlier" except "mapped" which stays "mapped"; fields set this turn keep their new source.
   - status "complete" when previous has all four required fields and the new turn says nothing; goal from an earlier turn is kept.
   - draft is not shared by reference with the previous state (mutating the result must not change the input state; assert it).
   - three turns in a row fill the four required fields one at a time and end "complete" with an empty questions list.
   - questions are in the order roleFamily, level, yearsExperience, region.
   - compBand from the text ends up in the Profile when complete.
   - a model call that fails to parse (reply("not json") twice) rejects with a typed model error and no draft is returned; use the mock for the repair retry.

## Create docs/parts/part-9-intake-agent.md
Plain-language guide for someone new to the project. Include:
- The problem: people describe themselves in sentences or a screenshot, but the engine needs a validated profile. Intake reads, code checks, the person confirms. Nothing it produces is verified.
- A text pipeline diagram: INPUT (sanitise, cap 6000 characters; image checks) then REDACT (emails, phones, links) then MODEL reads (fields with the words they came from) then VALIDATE (code decides each field) then MERGE with earlier turns then RESULT (draft, provenance, missing, questions, warnings).
- A table of every field: roleFamily, level, yearsExperience, region, compBand, stack, milestones, goal. For each: what the model returns, the exact rule code applies (read validate.ts), and one example of a refusal with its message.
- A section "When Intake asks instead of guessing" with the real examples from evals/intake/cases.ts: a title like "senior engineer" is not a level; a company the level table does not know; "since 2018" is not years of experience; a salary is not a pay band; an unknown region.
- A section on the level table: companies and titles from data/level-map.json mapped to canonical levels (print the real table).
- A section on images: what is checked (real bytes, size, 64 pixels for PNG), what is not possible (the quote cannot be verified, so fields are marked "image" and must be confirmed; names inside an image cannot be removed; crop them), and that text and an image are read in two calls with the image winning.
- Privacy: what redaction does and does not do (names and employers remain), that the text sent to the model is the redacted text, and that the Privacy Guard in Part 10 is a second layer.
- Untrusted input: quote guard, enumerated values, ranges, skill-name rule, instructions hidden in text or images are data.
- Multi-turn: how a follow-up answer merges (newer wins, lists combine) with a short example.
- Honesty rules: verified is always false, milestones always verified false, no guessing, coverage warnings (read intake.ts warningsFor): unsupported goal, thin cohort, no comparable engineers.
- A table of the files in src/lib/intake/ and evals/intake/ with one line each.
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "Results of the live evaluation are added by the maintainer after measurement." (do not invent numbers).
- Known limits: English only; a title the table does not know cannot become a level; a city outside the examples may not map to a region; one image per call; images are not redacted; the model can still misread an unusual layout.
- How to verify: npm run check; npm run live:intake with both API keys exported.

## Rules
- BUG HUNT: if you find a bug in src/, do not fix it and do not write a failing test. Describe it in your final message (file, line, what is wrong, a concrete input, suggested fix). Look especially at: the redaction regexes (false positives and false negatives, catastrophic backtracking on a long input such as 6000 characters of digits and spaces: time it), phraseInText-based guards, the merge function, and anything that could throw on odd input.
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

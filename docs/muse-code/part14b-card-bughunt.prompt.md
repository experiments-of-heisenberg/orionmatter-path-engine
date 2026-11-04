# Task: trail-card edge tests and the bug-hunt report for Part 14 (tests and notes only)

Read AGENTS.md first. A previous run wrote most of the Part 14 tests but ran out of time before it wrote the trail-card tests and before it reported its bug hunt. You have 12 minutes. Work in this order and do not skip the report.

You must NOT change any file under src/, evals/, scripts/ or next.config.ts. Do not commit.

## Step 1 (at most 5 minutes): create tests/uiTrailCardEdges.test.ts
Read src/ui/trailCard.ts, src/components/TrailCard.tsx, src/components/SharePanel.tsx, the existing tests/uiTrailCard.test.ts and tests/uiShareRender.test.tsx and tests/helpers/{ui,privacy}.ts (do not duplicate them). Use renderToStaticMarkup for the SVG. Cover:
- trailCardModel with a ladder whose `passes` are not a prefix (true, false, true): state what is shown (the card must stop at the first failure).
- an empty ladder; a company-type rung whose `shared` string has commas inside the type name; k 1; k 10000.
- a sheet with fewer than three routes or none (state what happens; the SVG must still render without throwing).
- titleFontSize and the SVG: goal labels of exactly 24, 25, 36, 37 and 60 characters: assert the title's font-size attribute; compute title length x 0.55 x fontSize and assert it is under 1056 for the 24 and 36-character titles; for longer ones do NOT fail: write the result in a comment and list it in your final message.
- cardFileName with emoji, right-to-left text, 200 characters, only punctuation.
- the "Start here" pill: its x position plus its width stays inside 1200 for the labels Climb, Jump, Pivot.
- cardText for a model with nothing shown and no limit.
- NOTHING that the ladder withholds appears anywhere: build a person whose role, level, goal and region all have distinctive words, make the ladder withhold goal and region, and assert those words appear nowhere in the SVG markup (including aria-label and title), in cardText, or in cardFileName.

## Step 2 (at most 5 minutes): the bug hunt, reported
Read these and look for bugs: src/components/usePathState.ts (plan run, races with the explore hook), src/components/usePrivacy.ts, src/components/useIntake.ts, src/components/PathApp.tsx (the session rebuild by key and the intake hook living above it), src/components/IntakePanel.tsx, src/components/SharePanel.tsx, src/ui/exportCard.ts, src/ui/trailCard.ts, src/ui/intake.ts, src/ui/privacy.ts, src/ui/plan.ts, src/ui/trace.ts. Look especially for: a stale privacy ladder used for the card after the person changed; intake edits lost when the form re-initialises; state leaked or lost on the session rebuild; unescaped or unclipped user text on the card, in the text export or in a file name; object-URL leaks in the SVG-to-PNG path; focus handling after a tab switch; roles and labels; text that could overflow at 390px; dead code; numbers on screen code cannot back. For each real bug give file, line, what is wrong, a concrete input, a suggested fix. Do not write failing tests for bugs.

## Step 3: finish
Run `npm run check`. It must pass. Your FINAL message must contain: files created, the test count, the bug list, and the doubts. Send it even if Step 2 is incomplete; say what you did not get to.

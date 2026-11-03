# Task: extra tests, a bug hunt and a docs page for Part 13, the What if screen (tests and docs only)

Read AGENTS.md first and follow it. Part 13 added the What if tab: src/ui/limits.ts, delta.ts, scenarios.ts, tornadoLayout.ts, chat.ts (pure logic);
src/components/Controls.tsx, Chat.tsx, Insights.tsx (DeltaChips, TornadoPanel, WhatItTakePanel), Scenarios.tsx, WhatIfPanel.tsx, usePathState.ts (all state and every network call), PathApp.tsx;
the CSS under "what if" in src/app/globals.css; and a small engine change: `Relaxation.value` in src/lib/whatif/wouldItTake.ts plus the `WhatIfResult` type in src/lib/api/handlers.ts.
It is implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION. You must NOT change any file under src/, evals/, scripts/ or next.config.ts.

## Read first (do not edit)
All of the above, and the existing tests so you do not duplicate them: tests/uiLimits.test.ts, uiDelta.test.ts, uiScenarios.test.ts, uiTornado.test.ts, uiChat.test.ts,
uiWhatIfRender.test.tsx (static HTML), whatIfApp.test.tsx (jsdom: the real components and hook, the real route handlers behind a fetch stub, a scripted model),
tests/helpers/ui.ts, tests/helpers/whatif.ts. Vitest uses `// @vitest-environment jsdom` per file when a DOM is needed; @testing-library/react and user-event are installed.

## Create these test files (deterministic, offline, no timers longer than 400 ms)

1. tests/uiLimitsEdges.test.ts
   - sliderToLimit with -5, Infinity, -Infinity, 72.5, 73.4; limitToSlider with 0, -3, NaN (state what NaN gives and whether it can break the slider; report it if it can).
   - withLimit with NaN, Infinity (state what happens: report any value outside 1..240 or a non-integer that can reach the API).
   - normalise keeps unknown extra keys? (state it); sameConstraints with addSkills in a different case ("Rust" vs "rust") (state it).
   - cleanSkill with only punctuation, with unicode (e.g. "Café", "日本語"), with 40+ characters made of multi-code-unit characters (emoji): does slice(0,40) split a surrogate pair? Report it.
   - describeConstraints with riskTolerance low and high plus skills with markup characters (it must return raw text; escaping is the renderer's job).
   - applyRelaxation for every knob with null, undefined-like and wrong-typed values (no throw, input unchanged).

2. tests/uiDeltaEdges.test.ts
   - deltaChips where before and after have different route lists or a route missing (no throw, state it); recommended null on both sides (no chip); recommended unchanged but routes moved.
   - a route moving exactly at the thresholds on both axes at once with opposite signs ("mixed"); a route whose window is [x, x]; monthsMedian null.
   - ids are unique within one result; chips are in the order recommended, climb, jump, pivot.
   - text never contains "NaN", "undefined", "null" for a sweep of maxMonths 6..72 step 6 against the no-limit sheet (use exploreFor).
   - singular grammar: 1 engineer, 1 month, 1 point (build routes by hand).

3. tests/uiScenariosEdges.test.ts
   - four scenarios with the same headline rate: leader is null; two scenarios where one has rate null: null; negative or reversed ranges do not throw.
   - addScenario when the list contains a scenario whose id is not of the form sc-X (hand-built): which id is chosen, no duplicates of ids ever (loop add/remove 50 random steps with a seeded generator and assert ids stay unique and the list never exceeds 4).
   - renameScenario with emoji, with only whitespace and newlines, with exactly MAX_NAME characters.
   - headlineText with n 1 and thin true, with months null, with rate [0, 0].

4. tests/uiChatEdges.test.ts
   - checkMessage with only emoji, with a 500-character message made of multi-code-unit characters (length counts UTF-16 units: state it), with \r\n, with a lone surrogate.
   - requestFor when the last turn is "error" after a "done" turn that had a question (the question is no longer open: state it).
   - progressTurn/finishTurn/failTurn with an unknown id (no change, no throw) and on an empty list.
   - startTurn ids after turns with gaps.

5. tests/uiTornadoEdges.test.ts
   - tornadoRows for a hand-built tornado with a single option per bar, with equal worst and best, with all options "none within your limits", with a current value not among the options (current null).
   - tornadoSummary rounding: swing 0.4 and 0.6 and 1.0 (state which sentence each gets).
   - every row's from/to are within [0,1] for every constraint set in a sweep (use exploreFor with maxMonths in {6,12,24,48,72}, minCompBand in {B1..B5}, remote, noRelocation).

6. tests/whatIfAppEdges.test.tsx (jsdom; copy the fetch-stub pattern from whatIfApp.test.tsx; do not import from it)
   - a second chat message sent while the first is still working: the Ask button is disabled and the Enter key does nothing (no second request).
   - the chat turn finishes after the person has already moved the slider: state which limits win (read usePathState.send) and assert it; report it as a doubt if it surprises you.
   - an explore failure after a successful load keeps the old map on screen and shows the error alert; Try again recovers. (Check what the screen shows; report if the error replaces the data.)
   - two rapid "Save these limits" clicks on identical limits produce one scenario.
   - Compare radar toggles survive a tab switch to What if and back (hidden state lives in PathApp).
   - Tab arrow keys move through four tabs and wrap.
   - an explore response with conflicts shows the notice on both the Map tab and the What if tab.
   - unmounting during an in-flight explore call aborts it (the signal's aborted flag is true) and causes no React warning (spy on console.error).

7. tests/uiCssWhatIf.test.ts (read src/app/globals.css as text; extend, do not edit, tests/uiCss.test.ts)
   - every class used by the What if tab's markup (render it through PathView with real data, as uiWhatIfRender does) is defined in globals.css or on an allowlist with a reason; report any that is not.
   - the new custom property --on-accent is defined in :root and in the dark block; .button--primary uses it; there is no hard-coded white text on --accent anywhere.
   - at max-width 860px the What if grid, the take cards and the tornado ends collapse; .scenarios__table has a min-width so its wrapper scrolls instead of squeezing.
   - the slider, choice buttons and switch have a minimum height of at least 32px (parse min-height/height values) for touch.

## Create docs/parts/part-13-what-if-screen.md
Plain-language guide for someone new to the project. Include:
- The problem: people want to ask "what if" without waiting on a model, and need to see what moved and why. Two paths: sliders use the instant model-free explore route; sentences use the streaming whatif route.
- The tab top to bottom (map, what changed chips, cards, limits, chat, which limit matters most, what would it take, scenarios) and where each number comes from.
- How the state works (usePathState): constraints, debounce 120 ms, abort of superseded requests and the aborted-response guard, baseline for the chips, the refs used by the stream, applying interpretation.next only when it changes something.
- The chat: what a turn shows (applied with the quoted phrase, not applied, cannot be modelled, conflicts, a question with options, the explanation with its source, the facts behind it), how a reply to a question is sent as history, the 500-character limit kept in step with the server by a test.
- The delta chips: thresholds (5 points, 3 months) kept equal to the server's by a test, tones and their words, the rules for gained/lost routes.
- The tornado: scale, worst-to-best bars, "none within your limits" at zero, the swing rounded like the server, why risk and skills are not bars.
- What would it take: one change at a time, the structured `value` field and applyRelaxation, "Try this".
- Scenarios: four at most, duplicate refusal, letters A-D, rename, open, remove, honest leader ("clearly" only when the leader's low end beats the runner-up's high end; ties have no leader), browser-only storage.
- Accessibility: every control is labelled, the slider's aria-valuetext, switches with role switch, groups, aria-live regions, text equivalents, focus order.
- Honesty: ranges with counts everywhere; the model only reads the sentence and phrases the explanation; code owns every number; skills are association not cause.
- A table of the new files, one line each.
- How to verify: npm run check; npm run build; npx tsx scripts/render-preview.tsx /tmp/preview (writes whatif.html and whatif-phone.html).
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "Results of the live evaluation are added by the maintainer after measurement." (do not invent numbers).
- Known limits: scenarios are not saved across reloads; a chat answer applies the limits as they were when it was asked; the map does not animate between states; the time slider stops at 72 months (typing can go higher).

## Rules
- BUG HUNT: if you find a bug in src/, do not fix it and do not write a failing test. Describe it in your final message (file, line, what is wrong, a concrete input, suggested fix). Look especially at:
  race conditions in usePathState (stale responses, chat finishing after slider moves, abort handling, baseline set from a response that was not the starting limits), state lost on tab switch,
  the Constraints object being mutated, validity of values reaching the API (maxMonths outside 1..240, non-integer, more than 5 skills, skills longer than 40), focus handling after a chat answer,
  labels and roles (output htmlFor, switch with a visible name, group labels, duplicate ids), keyboard traps, text that could overflow at 390px, escaping of user text, and any claim on screen
  that numbers cannot back (for example "clearly ahead" with overlapping ranges, a best value that is tied with another).
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

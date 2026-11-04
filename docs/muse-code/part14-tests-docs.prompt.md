# Task: extra tests, a bug hunt and a docs page for Part 14, the agent-story screens (tests and docs only)

Read AGENTS.md first and follow it. Part 14 added five things to the screen:
- Plan tab and Agent Trace: src/ui/trace.ts, src/ui/plan.ts, src/components/PlanPanel.tsx, TracePanel.tsx, and `stepMarkers` in src/ui/mapLayout.ts (numbered plan steps on the map, drawn by Constellation.tsx); the plan run lives in src/components/usePathState.ts (`onBuildPlan`).
- Privacy tab: src/ui/privacy.ts, src/components/PrivacyPanel.tsx, usePrivacy.ts; plus a small change to src/lib/privacy/detectors.ts (pay written in words and with a currency prefix).
- Your story tab (intake): src/ui/intake.ts, src/components/IntakePanel.tsx, useIntake.ts, and the session remount in PathApp.tsx (`PathApp` holds the person and rebuilds `PathSession` by key when a person is confirmed).
- Share tab: src/ui/trailCard.ts, src/ui/exportCard.ts, src/components/TrailCard.tsx, SharePanel.tsx.
- src/lib/limits.ts (MAX_SKILLS moved out of the zod-using schemas so the browser does not download zod), src/ui/text.ts (clip), the CSS added to src/app/globals.css under "plan and agent trace", "privacy", "your story", "share".
It is implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION. You must NOT change any file under src/, evals/, scripts/ or next.config.ts.

## Read first (do not edit)
All of the above and the existing tests so you do not duplicate them: tests/uiTrace.test.ts, uiPlan.test.ts, uiStepMarkers.test.ts, uiPlanRender.test.tsx, planApp.test.tsx, uiPrivacy.test.ts, uiPrivacyRender.test.tsx, privacyApp.test.tsx, privacyPayWords.test.ts,
uiIntake.test.ts, uiIntakeRender.test.tsx, intakeApp.test.tsx, uiTrailCard.test.ts, uiExportCard.test.ts, uiShareRender.test.tsx, shareApp.test.tsx, browserBundle.test.ts, and the helpers tests/helpers/{ui,plan,privacy,intake,whatif,api}.ts.
Static render tests use react-dom/server's renderToStaticMarkup; interactive tests put `// @vitest-environment jsdom` on the first line and use @testing-library/react with a fetch stub that calls the real route handlers (copy the pattern from planApp.test.tsx; do not import from other test files).

## Create these test files (deterministic, offline, no timers longer than 400 ms)

1. tests/uiTraceEdges.test.ts
   - describeCall with args that are arrays, numbers, huge objects; names with unicode and markup characters (it must not throw and must cut the name to 40 characters; state what happens to a name with a surrogate pair cut at 40).
   - reduceTrace with a tool_result whose id matches a call that already has a result (second result for the same id: state which wins), two calls with the same id (state what happens), a verdict whose rejections have routeIndex -1 and no stepIndex, a stage event with an unknown stage name (label falls back to the raw name), events arriving after `done`.
   - groupRejections with 200 rejections of 13 codes: group count, order, no loss; verdictHeadline with 1000 rejections.
   - traceSummary singular/plural for every count 0, 1, 2 of calls, checks, revisions.
   - STAGE_LABEL has an entry for every stage in the AgentEvent type (derive the list from a literal array in the test and compare to Object.keys).

2. tests/uiPlanEdges.test.ts
   - planProgress and planFinished called in odd orders (finished before started, failed after finished, finished twice): state exactly what happens and report anything surprising.
   - planIsStale where forConstraints has skills in a different order or case.
   - planHeadline with revisions 0, 1, 5 and with `verdicts: []` for an unresolved run (state the sentence).
   - windowText with negative, fractional, reversed windows ([12, 6]) and NaN (state what each prints; report a misleading sentence).
   - stepsForMap when the plan contains duplicate archetypes (state which route wins).

3. tests/uiStepMarkersEdges.test.ts
   - stepMarkers with a reversed window [30, 10], NaN months, negative months, windows beyond the axis, 100 steps (no throw; x values stay finite and inside the picture; report if markers can leave the line or overlap badly), steps given out of order in time (state the output order).
   - for COMPACT and DESKTOP across maxMonths in {undefined, 6, 12, 24, 48, 120}: every marker's x is between origin.x and the lane's end x, its y is between the origin's y and the lane's y, and indexes are 0..n-1 in order.
   - MARKER_GAP holds between neighbours whenever the line is long enough; when it is not, state what happens.

4. tests/uiPrivacyEdges.test.ts
   - ladderRows with decreasing, increasing (impossible) and equal sizes; sizes 0, 1, 10^6; passes flags inconsistent with sizes (the rows must still be well formed).
   - kPosition with k 0, negative, NaN, Infinity (state what each returns; report a NaN that could reach a CSS style).
   - shareSummary with k 1; findingGroups with all 11 categories at once (titles unique); checkStory with only emoji, only newlines, 3000 characters made of multi-code-unit characters (state that length counts UTF-16 units), a lone surrogate.
   - privacyBody with k NaN (state what the JSON would contain and report it as a doubt if the server would reject it).
   - detectIdentifiers (pay words and prefix, src/lib/privacy/detectors.ts): a sweep of 25 strings with amounts in different forms ("12,00,000 Rs", "Rs 5", "rs.50000", "USD 100", "100 dollars", "3 pounds of flour", "I have 2 euros", "5 Rs-compatible", "$", "rupees 5") stating which are flagged. Report any plainly wrong result (a false positive on ordinary prose or a clear miss) in the final message as a doubt, never by failing a test.

5. tests/uiIntakeEdges.test.ts
   - personFromForm: years "7e0", "0x10", " 7 ", "7,5", "٧" (Arabic digit), "Infinity", "-0"; level lower-case "l5"; region with whitespace; goalLabel with markup; stack items that duplicate ignoring case (state it); compBand "b4" lower-case (state it).
   - previousFrom: a form whose years is "7.5", stack longer than 15, milestones longer than 20 (clipped), a goal label of 90 characters (clipped to 60), compBand invalid; check the output validates against the server's IntakeRequest zod schema (import IntakeRequest from src/lib/api/schemas and parse { previous }) for 30 random-but-seeded forms (use a small seeded generator in the test).
   - editedKeys when only goalLabel changes, only the stack order changes, only milestones change.
   - checkImageFile with size 4*1024*1024 exactly and +1, type "IMAGE/PNG" (upper-case: state it), type "", a file named .png with type text/plain.
   - withStackAdded with 40-character emoji names (clip must not split a pair), whitespace only, existing name in another case.
   - fieldSource and provenanceText for every provenance source with and without quote/via.

6. tests/uiTrailCardEdges.test.ts
   - trailCardModel with a ladder whose passes are not a prefix (true, false, true): state what is shown (the card must stop at the first failure).
   - an empty ladder; a ladder with a company-type rung whose `shared` string has commas inside the type name; k 1; k 10000.
   - `routes` shorter than three or empty in the sheet (state what happens; the SVG must still render).
   - titleFontSize and the SVG: a goal label of exactly 24, 25, 36, 37, 60 characters: render the SVG with renderToStaticMarkup and assert the title's font-size attribute; assert the title text length times an estimated 0.55*fontSize px width stays under 1056 px for 24 and 36-character titles and REPORT (do not fail) for longer ones if it would overflow the card.
   - cardFileName with emoji, RTL text, 200 characters, only punctuation.
   - the "Start here" pill x position for labels "Climb", "Jump", "Pivot" stays inside the card.
   - cardText for a model with no details shown and no limit.

7. tests/uiPlanPrivacyIntakeApp.test.tsx (jsdom; one file for cross-tab behaviour; copy the fetch-stub pattern)
   - state kept across tabs: a built plan, the privacy draft text, the intake form edits, scenarios: switch through every tab and back and assert each is intact.
   - confirming a person from the Your story tab resets: plan, privacy draft and ladder settings, scenarios, chat turns, the selected route and the Compare toggles all go back to fresh (the session is rebuilt by key). The intake form itself keeps what was typed (state it).
   - the privacy ladder is requested again for the confirmed person (check the request profile).
   - the Share tab for a confirmed person uses that person's role and region, not the sample's.
   - build a plan, then change a limit on the What if tab, then open Share and Plan: no step markers on the Map tab; the Plan tab says the plan is for earlier limits.
   - the tab order from TABS is rendered; keyboard arrows reach Your story, Privacy and Share.
   - three simultaneous requests (plan running, privacy ladder reloading after changing k, intake reading) finish independently without a React warning (spy on console.error).

8. tests/uiCssPart14.test.ts (read src/app/globals.css as text; extend, do not edit, the existing css tests)
   - every class used by the Plan, Privacy, Your story and Share tabs' markup (render PathView for each tab with real data as the existing render tests do, in several states) is defined in globals.css or on an allowlist with a reason; report any that is not.
   - every var(--name) used in the new CSS sections is defined in :root and in the dark block (--ok-bg and --ok-fg must be defined in both).
   - there is no hard-coded text colour on --accent backgrounds in the new sections (.plan-stepcard__n uses --on-accent).
   - at max-width 860px the privacy settings and the form grid collapse to one column; `.tabs` scrolls horizontally (overflow-x) rather than wrapping or overflowing the page.
   - the reduced-motion block still disables the trace pulse animation (it uses `animation: none !important` on every element).

## Create docs/parts/part-14-agent-story-screens.md
Plain-language guide for someone new to the project. Include:
- The problem: a score is not enough for a career decision; people need to see HOW the plan was made, what the Skeptic objected to, what sharing reveals about them, to enter their own story safely, and to share a trail without being identified.
- The tabs, in order, and what each shows and where its data comes from (which route, model or code): Your story, Map, What if, Plan, Compare, Privacy, Share, Why.
- The Agent Trace: stages, the evidence lookups (chosen by Muse Spark or filled in by code and why), every Skeptic objection with the exact words, what "approved" and "unresolved" look like and why an unresolved plan is never put on the map; the 200-item cap.
- Plan steps on the map: how a step is placed on the curve (bisection on x), the minimum gap, why only approved and current plans are drawn, why the markers are hidden from screen readers (the Plan tab lists them in text).
- Privacy: the ladder explained with the sample person's numbers (197, 93, 68, 11, and 4 with robotics), the k line, the two kinds of text check (Muse Spark vs code only) and exactly what is sent where, the guard (a model finding must quote the text), what code detects, the new pay-in-words rule, the honest "synthetic cohort" basis.
- Your story: text or screenshot, the crop warning and why (a picture goes to the model as it is), redaction of typed text, provenance words, the form, required fields, half-year rule for experience, how an answer to a question keeps corrections (previousFrom), confirm, and the session rebuild by key and why (nothing from the sample can leak).
- Share: what is on the card and why (ladder decides), what is withheld and named as withheld, what is never shown (years, stack, free text), saving as PNG/SVG, copying text, "made in your browser, nothing uploaded", the fallback when canvas is missing.
- The bundle: why MAX_SKILLS moved to limits.ts (zod was 500 KB of the browser bundle), and the bundle test.
- Accessibility: roles, labels, live regions, text equivalents (list them), keyboard, tabs scroll on a phone.
- A table of the new files, one line each.
- How to verify: npm run check; npm run build; npx tsx scripts/render-preview.tsx /tmp/preview (writes plan.html, map-plan.html, privacy.html, share.html, you.html).
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "Results of the live evaluation are added by the maintainer after measurement." (do not invent numbers).
- Known limits: a plan is not saved across reloads; the card is a picture of ranges and cannot prove anything about the person; the pay-in-words detector is a pattern, not a guarantee; screenshots cannot be redacted; intake is not verified; the trace shows only what the stream reported.

## Rules
- BUG HUNT: if you find a bug in src/, do not fix it and do not write a failing test. Describe it in your final message (file, line, what is wrong, a concrete input, suggested fix). Look especially at: races between the three network hooks (plan, privacy, intake) and the explore hook; state lost or leaked on a tab switch or on the session rebuild; the intake form re-initialising and losing edits; a stale privacy ladder used for the card after the person changed; the share card showing a detail the ladder withholds (including via the title, the aria-label, the text export or the file name); anything on the card, in the text export or in a file name that comes from user text without escaping or clipping; the SVG-to-PNG path (object URL leaks, onload never firing, fonts); focus handling after a tab switch; labels and roles; text that could overflow at 390px; unreachable or dead code; numbers on screen that code cannot back.
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

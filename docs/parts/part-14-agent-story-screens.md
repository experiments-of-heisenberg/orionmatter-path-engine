# Part 14: The agent-story screens

**Goal:** turn the planner from a score into a story a person can trust —
show HOW each plan was made and what the Skeptic objected to, show what
sharing reveals, let people enter their own story safely, and let them share
a trail without giving themselves away.

## The problem

A score is not enough for a career decision. "Jump: 18–23 months" answers
_what_, but a person deciding years of their life needs _how_: how was this
plan made, what evidence stands behind each step, what did the Skeptic
object to, and was every objection answered? They also need to know what
their own words reveal about them before they post a bio, to enter their own
story instead of looking at a sample engineer, and to share their three
routes as a picture that cannot identify them.

Part 14 adds four tabs and the agent trace to answer exactly that, while
keeping the project's rules: every number comes from a deterministic tool,
every claim cites evidence, outcomes are ranges with counts, and everything
is checked at the boundary.

## The tabs, in order

| Tab        | What it shows                                                                                           | Where the data comes from                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Your story | A text box or screenshot upload, what the reader found, and the form to check and confirm               | The streaming `/api/intake` route (Muse Spark reads, code validates); the form is local state |
| Map        | The constellation, now with numbered plan steps on one route's line when a current approved plan exists | The instant `/api/explore` route (code only) plus the plan run                                |
| What if    | Limits, chat, tornado, scenarios — unchanged, except a stale plan's steps leave the map                 | `/api/explore` and `/api/whatif`, as in Part 13                                               |
| Plan       | The "Build my plan" button, the plan itself with the Skeptic's verdict, and the Agent Trace             | The streaming `/api/plan` route (Planner, then Skeptic, then revisions)                       |
| Compare    | The radar and table — unchanged                                                                         | The explore sheet, as before                                                                  |
| Privacy    | The disclosure ladder for a chosen crowd size, and an optional check of pasted text                     | The `/api/privacy` route: the ladder is code only; the text check optionally uses Muse Spark  |
| Share      | The trail card preview, what is on it and what is withheld, and three ways to save it                   | The explore sheet plus the privacy ladder; the card is built in the browser                   |
| Why        | The explanation — unchanged                                                                             | The explore sheet, as before                                                                  |

The app still opens on a sample engineer so there is something to see at
once; a banner on every tab except Your story says so and offers a button to
it. "Your story" is the first tab so a new person meets it first.

## The Agent Trace

While a plan runs — about half a minute — the Plan tab fills in a live
Agent Trace: what happened, in order. Nothing is staged: an item exists only
because the run streamed an event for it.

- **Stages.** Reading the story, protecting privacy, understanding the
  request, gathering evidence, writing the three routes, the Skeptic's
  check, revising after objections, and finished. The current stage is also
  announced as a status line while the run goes.
- **Evidence lookups.** Every tool the Planner called, in words ("Count
  outcomes on the jump route"), with what came back and the evidence id a
  claim can cite. Each lookup says who chose it: **Chosen by Muse Spark**
  when the model decided to call it, **Filled in by code** when the model
  skipped a lookup the plan needs and deterministic code ran it instead —
  because a plan may only cite evidence that exists, and a skipped lookup
  would leave claims with nothing behind them.
- **Every Skeptic objection with the exact words.** Each verdict lists its
  rejections grouped by kind ("Sample size does not match the evidence",
  "Promised or guaranteed an outcome", "Raised by the model-based
  reviewer", and the rest), and each rejection quotes the exact claim text
  it objected to alongside the reason. Notes the Skeptic added are listed
  too.

A run ends in one of two ways. **Approved** means the last check found no
objections: "The Skeptic approved this plan on its first check" (or "after
N revisions"). **Unresolved** means objections remain after the allowed
revisions: the panel says how many remain, warns before relying on it, and
shows every one. An unresolved plan is never put on the map, because its
claims include ones the Skeptic did not clear — and neither is a stale
plan, one made for limits the person has since changed.

The trace keeps at most **200 items**; past that it stops appending and says
it dropped some, so a runaway stream cannot grow the page without bound.

## Plan steps on the map

When the plan is approved and its limits are still the current ones, the
selected route's steps appear on the Map tab (and the What if map) as small
numbered markers along that route's line.

- **Placement.** A step sits where the line is at the middle of the step's
  month window. The line only ever moves right, so x grows along it, and the
  point is found by bisection on x (30 rounds). Steps past the end of the
  line stop at its end, before the star; ghost and no-data routes get no
  markers.
- **The minimum gap.** Markers on one line keep at least 18 map units
  apart: starting from the last, each is pushed left until it clears its
  neighbour. When a line is too short for that, the first markers overlap
  at the start of the line rather than leave it.
- **Why only approved and current plans.** See above: unresolved claims and
  moved numbers must not dress up as guidance.
- **Hidden from screen readers.** The markers are decoration (`aria-hidden`)
  because the Plan tab already lists the same steps as text with the same
  numbers — the text list is the equivalent, and a screen reader meets each
  step once.

## Privacy

The Privacy tab answers one question in numbers: as you share more about
yourself, how many comparable engineers in the cohort still match?

- **The ladder.** Each step adds one detail — role, then level, then goal,
  then region, optionally a company type — and counts who still matches.
  For the sample engineer at the default crowd size: **197** match the
  role, **93** the role and level, **68** with the goal, **11** with the
  region; adding **robotics** as the company type drops the last step to
  **4**, below the crowd. Each bar carries the number, a plain sentence
  ("Sharing backend, L5 leaves 93 comparable engineers who match"), and a
  tag saying whether it keeps you in the crowd.
- **The k line.** A dashed line marks the crowd size you want to stay
  inside (5, 10, 20 or 50; 10 is the default). A summary sentence says what
  is safe to share and what to leave out to get back inside.
- **Two kinds of text check.** Paste a bio or post and choose: **Check with
  Muse Spark** sends your text to the model with emails, phone numbers and
  links removed first, and code keeps only reported details whose quote is
  really in your words; **Check with code only** sends it to this app's
  server but never to the model, and only code's three pattern checks run.
  The panel says which is which before you press either.
- **The guard.** A model finding must quote your own words, and code checks
  the quote against your text. A proposed detail with no quote in the text
  is discarded and counted ("Discarded 1 proposed item"), never shown.
- **What code detects.** Contact details (emails, phone numbers, links),
  exact dates, and exact pay figures — all fixed patterns, always the same
  way. The new **pay-in-words rule** also catches amounts written with
  currency words ("4200000 rupees", "85,000 dollars") and with a currency
  prefix ("Rs. 12,00,000", "INR 45000"), alongside the symbol and unit forms
  ("$180k", "30 LPA").
- **The honest basis.** The cohort is synthetic, and the panel says the
  ladder demonstrates the method — it is not a guarantee about real-world
  uniqueness.

## Your story

The Your story tab replaces the sample engineer with the person.

- **Text or screenshot.** Write a few lines, or upload a cropped PNG, JPEG
  or WebP picture up to 4 MB.
- **The crop warning, and why.** A picture goes to the model exactly as it
  is — names, photos and contact details inside it cannot be removed — so
  the warning sits above the file picker, before anything is chosen, and
  says to crop to only the career details to be read.
- **Redaction of typed text.** Text you type has emails, phone numbers and
  links removed before the model reads it; the panel lists what was
  removed.
- **Provenance words.** Under each field of the draft is where it came
  from: "From your words: …" with your own quote, "Read from your
  screenshot. Please check it.", "From your earlier answer", "Worked out
  from …", or "Entered by you" for anything you typed or changed. Proposals
  code refused are listed with the reason, never hidden.
- **The form.** Role, current level, years of experience, region, goal
  level, what you call the goal, technologies (up to 15), and anything the
  reader found. Required fields say **Needed** until filled.
- **The half-year rule.** Years of experience must be a number from 0 to 40
  in whole or half years ("7" and "7.5" pass; "7.25" does not).
- **Answers keep corrections.** When the reader asks a follow-up question,
  the answer is sent with the form's valid fields as the earlier draft, so
  nothing already corrected is lost — and only the provenance of untouched
  fields travels with it.
- **Confirm, and the session rebuild.** "Use this for my routes" validates
  the form and turns it into the person the rest of the app uses, with
  fresh default limits. The whole session is then rebuilt by key — a new
  React key remounts everything below the intake state — which is the
  simplest way to be sure nothing from the sample (scenarios, plans, chat,
  privacy draft) can leak into the new screen. The form itself lives above
  the rebuild, so what was typed stays visible.

## Share

The Share tab turns the three routes into a card for posting — but only
what the privacy ladder allows.

- **What is on the card, and why.** The ladder decides: details are shown
  up to the last rung that keeps the crowd at k or more, and the card
  carries the crowd size behind them. The routes are cohort ranges with
  engineer counts ("74–92% · 55 engineers"), the best-fit route says
  "Start here" in words, the time limit appears when there is one, and the
  footer stays honest: "Synthetic cohort of 484 engineers. Ranges, not
  promises."
- **What is withheld is named.** Details past the first failing rung are
  listed as withheld with why ("South India (withheld to keep you in a
  crowd of 50 or more)"), and the title stops naming the goal when the goal
  is withheld. Nothing is silently dropped.
- **What is never shown.** Years of experience, technologies, the pay band,
  and anything written are never put on the card — the panel says so, and
  tests assert the strings cannot appear.
- **Saving.** Save as picture (PNG, drawn at twice the size), Save as SVG,
  or Copy as text for places a picture cannot go. File names are made safe
  (lower-case letters, digits and dashes). The card is made in your
  browser, and nothing is uploaded.
- **The fallback.** If the browser has no canvas, or the picture cannot be
  drawn or encoded, the panel says so plainly and points at the SVG, which
  needs nothing but the card itself.

## The bundle

The browser must not download the server's world. When the What-if
interpreter's skill limit lived in the Zod schema module, importing it for
one number pulled the whole request-checking library — about 500 KB — into
the app. Part 14 moves `MAX_SKILLS` into `src/lib/limits.ts`, a file with
no imports that both sides share, and `schemas.ts` re-exports it so server
imports keep working. The bundle test builds the app for the browser and
asserts it reaches no Node module, carries no cohort data or keys, contains
no Zod, and stays under 400 KB.

## Accessibility

- **Roles and labels.** Tabs use tablist/tab/tabpanel with roving tabindex;
  map routes are buttons with pressed state; switches, groups and the card
  image (`role="img"` with a full description) are all labelled.
- **Live regions.** The plan status, the map caption, the privacy result,
  and save confirmations announce through `status`/`polite` regions;
  failures use `alert`.
- **Text equivalents.** Every drawing is also said in words: the step
  markers duplicate the Plan tab's numbered list; the card has a "card as
  text" block and an `aria-label` naming every route and range; each ladder
  bar has its sentence plus the share summary; the trace's Running/Done/
  Failed words never rely on colour; the start-here route and withheld
  details are named, not just coloured.
- **Keyboard.** Left and right arrows move between tabs with focus and wrap
  around; map routes answer to Enter and Space; every action is a real
  button.
- **On a phone.** The tab strip scrolls horizontally instead of wrapping,
  the privacy settings and the story form collapse to one column, and the
  card scales to the screen width.

## Files

| File                              | What it is                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/ui/trace.ts`                 | The Agent Trace as plain data: folding events, grouping objections, the summary sentence  |
| `src/ui/plan.ts`                  | A plan run as plain data: starting, streaming, staleness, the headline, steps for the map |
| `src/components/TracePanel.tsx`   | The trace itself: stages, lookups, verdicts with exact quoted words                       |
| `src/components/PlanPanel.tsx`    | The Plan tab: build button, routes with claims, caveats, the trace below                  |
| `src/ui/privacy.ts`               | The Privacy tab as plain data: ladder rows, sentences, groups, story checks, the request  |
| `src/components/PrivacyPanel.tsx` | The Privacy tab: ladder chart, settings, text check with findings and preview             |
| `src/components/usePrivacy.ts`    | The Privacy tab's state: ladder loading, text checks, the surviving draft                 |
| `src/ui/intake.ts`                | Your story as plain data: input checks, provenance words, the form, confirming            |
| `src/components/IntakePanel.tsx`  | The Your story tab: text box, upload, what was read, the form                             |
| `src/components/useIntake.ts`     | Your story's state: reading, answering, the form above the session rebuild                |
| `src/ui/trailCard.ts`             | The card as a model: ladder decides shown and withheld, routes, text, file names          |
| `src/ui/exportCard.ts`            | Saving from the browser: SVG text, downloads, PNG on a canvas, clipboard                  |
| `src/components/TrailCard.tsx`    | The card drawn as one fixed-size SVG with a full description                              |
| `src/components/SharePanel.tsx`   | The Share tab: what is on and off the card, preview, three ways to save                   |
| `src/lib/limits.ts`               | Numbers both sides share with no imports, so the browser skips Zod                        |
| `src/ui/text.ts`                  | Small text helpers: clipping without splitting an emoji pair                              |

Changed rather than added: `stepMarkers` in `src/ui/mapLayout.ts` with
their painting in `Constellation.tsx`, the plan run in `usePathState.ts`,
the pay-in-words detector in `src/lib/privacy/detectors.ts`, the session
remount in `PathApp.tsx`, and the four new sections of `src/app/globals.css`
(plan and agent trace, privacy, your story, share). Tests live beside the
rest in `tests/`: the `uiTrace`, `uiPlan`, `uiStepMarkers`, `uiPrivacy`,
`uiIntake`, `uiTrailCard` and `uiExportCard` suites with their `Edges`
companions, the `Render`/`App` suites per tab, the cross-tab
`uiPlanPrivacyIntakeApp` suite, and the `uiCssPart14` stylesheet suite.

## How to verify

```sh
npm run check   # typecheck, lint, format check, tests, secret scan
npm run build   # the production build, including its own typecheck
npx tsx scripts/render-preview.tsx /tmp/preview   # static HTML previews for a browser
```

The preview script writes `plan.html`, `map-plan.html`, `privacy.html`,
`share.html` and `you.html` (alongside the earlier previews): the real Plan
tab with a finished run and its trace, the map with numbered steps, the
Privacy tab with a ladder and a checked story, the Share tab with the card,
and Your story with a completed reading.

## Live evaluation

Results of the live evaluation are added by the maintainer after measurement.

## Known limits

- A plan is not saved across reloads; rebuilding it runs the agents again.
- The card is a picture of ranges and cannot prove anything about the person.
- The pay-in-words detector is a pattern, not a guarantee: it can miss odd
  phrasings and flag ordinary prose that happens to be pay-shaped.
- Screenshots cannot be redacted; a picture is sent to the model as it is.
- Intake is not verified: the form is only what the person said, checked for
  shape, never for truth.
- The trace shows only what the stream reported; a lookup that never emitted
  an event leaves no item.

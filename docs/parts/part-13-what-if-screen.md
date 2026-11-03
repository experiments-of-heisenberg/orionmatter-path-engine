# Part 13: The What if screen

**Goal:** let a person ask "what if" — with a slider or a sentence — and see
at once what moved, by how much, and why, with every number recomputed from
the cohort.

## The problem

A static map answers "where do I stand?" but planning is about trade-offs:
"what if I won't relocate?", "what if I need B4 or higher?", "what if I learn
Rust?" People want to try such changes freely, without waiting on a model for
every drag of a slider, and they need to see what moved and why — not just a
new picture, but the difference in words.

Two paths serve the two speeds:

1. **Sliders use the instant model-free explore route.** Moving a limit posts
   to `/api/explore`, which runs the deterministic engine only: no model, a
   few milliseconds, so the map redraws as you drag.
2. **Sentences use the streaming whatif route.** Typing "what if I won't
   relocate?" posts to `/api/whatif`, where the model reads the sentence and
   code recomputes the routes; the answer then applies the understood limits
   and the instant route redraws the map.

Either way the map never waits on a model, and every figure on screen comes
from code, as a range with the engineers behind it.

## The tab, top to bottom

The What if tab (`WhatIfPanel`) keeps the map on top and stacks the controls
and explanations below it:

| Part                     | What it shows                                                                              | Where the numbers come from                           |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Map                      | The constellation, redrawn for the current limits, with a caption about the selected route | The explore routes and the time limit                 |
| What changed             | One chip per route that moved since the starting limits                                    | `deltaChips(baseline, data)`                          |
| Cards                    | One card per route, as on the Map tab                                                      | The explore routes                                    |
| Your limits              | The time slider, pay choices, remote/relocation switches, risk choices, skill box          | The person's constraints; edits recompute via explore |
| Ask what if              | The chat: what was understood, what was not, the explanation                               | The whatif route (model reads, code recomputes)       |
| Which limit matters most | One bar per limit, worst value to best                                                     | The explore tornado                                   |
| What would it take       | The smallest single change that would help, or nothing-needs-to-give                       | The explore would-it-take options                     |
| Scenarios                | Saved sets of limits side by side, with an honest "highest" note                           | The saved constraints plus each sheet's headline      |

A conflict notice appears above the chips when the limits leave routes with
nobody inside them — the same notice the Map tab shows.

## How the state works

All state and every network call live in one hook, `usePathState` in
`src/components/usePathState.ts`. The panel itself is a function of its props.

- **Constraints are the single source of truth.** Every control edit produces
  a new normalised `Constraints` object (an "off" switch removes its key, so
  equal settings compare equal field by field).
- **Explore calls are debounced 120 ms.** A burst of slider movements asks the
  server once, for the last position. The first load skips the delay.
- **A replaced request is aborted, and a stale answer is ignored.** Each call
  gets an `AbortController`; the effect cleanup aborts it, and the response
  handler returns early if its request was aborted — so a slow answer can never
  overwrite newer numbers. The old numbers stay on screen until the new ones
  arrive.
- **The baseline feeds the chips.** The first completed answer is kept as the
  baseline; the "what changed" chips compare it with the current numbers.
- **Refs bridge the stream.** The chat stream outlives renders, so the latest
  turns and constraints are kept in refs (`turnsRef`, `constraintsRef`) that
  the stream callbacks read.
- **A chat answer applies only a real change.** When a turn finishes, the new
  limits from `interpretation.next` replace the current ones only if they
  differ; a reply that changes nothing leaves the numbers as they are.

## The chat

One box. The person types a sentence, the server understands it, code
recomputes the routes, and each answered turn shows up to four plain things:

- **Applied**: each change with the quoted phrase it came from ("No relocation,
  off → on, 'I won't relocate'").
- **Not applied**: phrases that were understood but refused, with the reason —
  never silently dropped.
- **Cannot be modelled**: phrases outside what the cohort can say, with why.
- **Things to know**: conflicts between the new limits and the evidence.

Plus, when part of the sentence was too vague, **a question with option
buttons**, and when anything moved, **the explanation**: a headline, short
points, a line saying where the words came from ("Phrased by Muse Spark. Code
checked every figure against the cohort." or "Written directly from the
computed facts."), and a "The facts behind this" list of the computed facts.

A reply to a question is sent with that question as history, so the model sees
what is being answered. Messages are limited to 500 characters, checked on the
screen before sending; the screen's limit is kept in step with the server's own
limit by a test, so the two can never disagree.

## The delta chips

Each chip compares one route now with the same route at the starting limits,
using the same thresholds as the server's own diff — 5 percentage points of
success, 3 months of time — kept equal to the server's by a test, so the chip
and the What-if agent's sentence always agree about what is worth saying.

Tones carry an icon and a word as well as a colour: Better ▲, Worse ▼,
Mixed ◆ (success and time moved in opposite directions), Note ● (for the
recommendation itself). A route nobody finishes within the limits any more is
reported with what it was; a route that becomes reachable is reported with its
new range, window and count. Every figure is a range with its engineer count,
and the arrow always comes with words ("up 12 points").

## The tornado

"Which limit matters most" tries each value of one limit while holding the
others as they are now, and draws one bar per limit from its worst value to
its best, widest swing first. The scale is the middle of the success range, 0
to 100 percent. Values with no one inside the limits sit at zero and read
"none within your limits" instead of an invented 0%. The black mark shows
where the person is now, and "Every value tried" lists each alternative with
its range and count for screen readers.

The swing is rounded like the server's (bar width in whole points equals the
reported swing), and the summary sentence names the top limit with its worst
and best values. Risk tolerance and skills are not bars: they reorder routes
or compare groups, and a bar would wrongly suggest they do nothing — the panel
says so in words.

## What would it take

When the limits leave little room, this panel offers the smallest single
changes that would bring a route to the target (ten comparable engineers who
made it, success centred on 50% or more): raise the time limit, lower the pay
floor, drop remote-only, allow relocation. One change at a time — no
combinations — and when no single change is enough, it says so.

Each option carries a structured `value` field (months, a band or null for "no
floor", false for a switch) alongside the display strings. The "Try this"
button applies that value through `applyRelaxation`, which ignores values of
the wrong kind rather than corrupting the settings.

## Scenarios

Up to **four** sets of limits can be saved, changed, and compared side by
side. Saving the same settings twice is refused, naming the scenario that
already has them; saving while the map is still catching up is refused with a
"wait" note. Scenarios take letters A–D (the first free letter is reused after
a removal), can be **renamed** (a blank name is ignored, a long one is cut to
30 characters), **opened** (restoring their limits), and **removed**.

The leader note is honest: "Highest, clearly" appears only when the leader's
low end beats the runner-up's high end; overlapping ranges read "Highest,
ranges overlap" with a sentence saying the data cannot tell them apart; and a
tie has no leader at all. Scenarios live in browser state only — they are not
saved across reloads.

## Accessibility

- **Every control is labelled**: the slider has a label plus an output, the
  skill box and chat box have labels, choice buttons show pressed state.
- The slider exposes its value in words through `aria-valuetext` ("24 months",
  "No limit").
- The remote and relocation switches use `role="switch"` with `aria-checked`
  and a visible name.
- Pay, risk and the chat question are `role="group"` sections with labels.
- **Live regions announce change**: the caption, the chips list and the
  conversation are `aria-live="polite"`; a working turn is a `status`, errors
  are `alert`s.
- **Every drawing has a text equivalent**: the tornado has a spoken summary
  plus the list of every value tried; chips pair icons with words; colour is
  never the only signal.
- **Focus order**: tabs use roving tabindex with left/right arrow keys that
  move focus and wrap; chat focus stays in the box while answers stream into
  the live conversation list.

## Honesty in the interface

Ranges carry counts everywhere ("74–92% of 55 engineers", "now based on 1
engineer"). The model only reads the sentence and phrases the explanation —
code owns every number, and the chat says so next to each answer. Skills are
labelled as association, not cause ("That is an association, not a cause").
Overlapping scenario ranges are called overlapping, thin evidence is called
thin, and the footer still says it plainly: a planning aid, not a promise.

## Files

| File                             | What it is                                                           |
| -------------------------------- | -------------------------------------------------------------------- |
| `src/ui/limits.ts`               | Constraints as the controls see them: slider mapping, edits, wording |
| `src/ui/delta.ts`                | What moved between two answers, in words, for the chips              |
| `src/ui/scenarios.ts`            | Saved branches: add, rename, remove, and the honest leader           |
| `src/ui/tornadoLayout.ts`        | The tornado's geometry: bars, current marks, summary sentence        |
| `src/ui/chat.ts`                 | The conversation as data: validation, turns, replies to questions    |
| `src/components/usePathState.ts` | All state and every network call: explore, chat stream, scenarios    |
| `src/components/Controls.tsx`    | The sliders and switches that edit the limits                        |
| `src/components/Chat.tsx`        | The What-if conversation box and its answers                         |
| `src/components/Insights.tsx`    | The chips, the tornado panel and the what-would-it-take panel        |
| `src/components/Scenarios.tsx`   | The saved-branches table with rename, open and remove                |
| `src/components/WhatIfPanel.tsx` | The What if tab, composing the map with every panel above            |

Two small engine-side additions support the tab: the structured
`Relaxation.value` field in `src/lib/whatif/wouldItTake.ts` and the
`WhatIfResult` type in `src/lib/api/handlers.ts`. The "what if" section of
`src/app/globals.css` holds the tab's styles. Tests live beside the rest in
`tests/`: `uiLimits`, `uiDelta`, `uiScenarios`, `uiTornado`, `uiChat`,
`uiWhatIfRender` (static HTML), `whatIfApp` (interactive), plus the `Edges`
suites and the `helpers/ui` and `helpers/whatif` helpers.

## How to verify

```sh
npm run check   # typecheck, lint, format check, tests, secret scan
npm run build   # the production build, including its own typecheck
npx tsx scripts/render-preview.tsx /tmp/preview   # static HTML previews for a browser
```

The preview script writes `whatif.html` and `whatif-phone.html` (alongside the
earlier previews): the real What if tab with a real conversation and saved
scenarios, on desktop and in a 390 px phone frame.

## Live evaluation

Results of the live evaluation are added by the maintainer after measurement.

## Known limits

- Scenarios are not saved across reloads; they live in browser state only.
- A chat answer applies the limits as they were when it was asked, not as they
  are when it lands.
- The map does not animate between states; it redraws at the new numbers.
- The time slider stops at 72 months; typing a sentence can go higher (the
  server accepts up to 120 months).

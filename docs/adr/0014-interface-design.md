# ADR 0014: A star chart that is also a time chart, with every figure in words

- Status: accepted
- Date: 2026-11-04

## Context

The product's claim is honest uncertainty: three routes, each a range with the number of engineers behind it. The first
screen has to make that understandable in seconds and look like something a person wants to open. Three earlier directions
(a topographic survey, an instrument panel, a transit map) and then a constellation chart, a trail guide and a clean card
layout were explored as mock-ups; the maintainer asked for the clean card setup, the constellation map made cleaner and
more modern, and the trail guide's charts.

## Decision

1. **The map is a time chart in a star chart's clothes.** Distance to the right is months from today, so the picture is
   honest, not decorative: each route is a thin line ending in a star at its median; a soft band is the typical window
   (P25 to P75); star size (square root scale) is how many engineers made it; hollow and dashed is limited evidence; a dashed
   gold line is the person's time limit, with a hatched "too late" region; a route nobody finished within the limits becomes a
   faint dotted ghost ending where the fastest engineer finished. Restrained line weights, one dark panel, no glow effects.
2. **Everything the picture says is also said in words**, in one pure module (`ui/format.ts`) shared by the map labels, the
   cards, the caption and the screen-reader text, so the picture can never disagree with the words.
3. **Clean light cards for the numbers**: one big range, a range bar on the same time scale as the map, a success meter, the
   sample size, and a status tag (Start here, Limited evidence, None within your limits).
4. **The trail guide's idea, made honest.** An elevation profile would need an invented path, so the detail chart shows what
   the data really has: the spread of months for every engineer who reached the goal (3-month bars, zoomed to where they are),
   the typical window shaded, the person's limit marked, and late finishers in grey. An outcome bar shows who reached it,
   reached it late, stalled or left the field.
5. **The screen is a pure function of its props** (`PathView`). It renders to static HTML for tests and for visual checks in a
   browser, and the app component only fetches and holds state. The numbers come from the instant `explore` route: no model,
   so the screen appears immediately and sliders in the next part can redraw it on every change.
6. **Accessibility is part of the design**: tabs with roles and arrow keys, every drawing has a text equivalent, route lines are
   buttons with full-sentence names, colour never carries meaning alone, reduced motion and both colour schemes are supported,
   and a separate compact map is used below 720 px (the other is hidden, so a screen reader meets one).

## Consequences

- Positive: the first screen is distinctive and still legible at a glance; the same wording appears everywhere; the What-if
  story is already visible (a limit line, ghost routes, grey late finishers).
- Negative: the map shows the median arrival, not the plan's steps; steps arrive with the Planner's plan in a later part.
- Negative: two map versions (desktop and compact) are rendered and one is hidden by CSS, which doubles that markup but avoids
  a flash of the wrong layout.

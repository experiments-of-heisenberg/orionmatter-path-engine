# Part 12: The Path Map and Compare interface

**Goal:** let a person see three career routes at a glance, understand how
sure we are about each one, and trust the numbers behind them.

## The problem

Until now the engine's answers lived in JSON: ranges, sample sizes, radar
scores. A person planning their career needs those answers as a picture they
can read in seconds, plus words that say the same things for when the picture
is not enough. Three needs drive the design:

1. **See three routes at a glance.** Which route is faster, which is safer,
   and how do they compare?
2. **Understand how sure we are.** A range from 55 engineers means more than
   one from 9, and the interface must never hide that difference.
3. **Trust the numbers.** Every figure comes from the deterministic engine,
   is shown as a range with its sample size, and the cohort is labelled
   synthetic wherever it appears.

The map is a picture; the cards and text say the same things in words. Nothing
is conveyed by a drawing alone: every chart has a text equivalent right next
to it, so the page reads the same with a screen reader or with the pictures
switched off.

## The screen, top to bottom

The screen is `PathApp`: it posts the person's profile, goal and constraints
to the instant `explore` route and draws the answer. There is no model call;
the numbers arrive in milliseconds from code. While loading, a labelled
skeleton holds the space; on failure, an alert with a Try again button.

From top to bottom on the Map tab:

| Part    | What it shows                                                                                                                      | Where the data comes from                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Hero    | The goal ("Your route to Staff Engineer") and chips: role, level, years, region, and the "Synthetic cohort of 484 engineers" label | The person's profile, plus a fixed cohort label       |
| Tabs    | Map, Compare, Why                                                                                                                  | Fixed                                                 |
| Map     | The constellation: three routes as lines to stars on a time axis                                                                   | The explore routes and the person's time limit        |
| Caption | One plain sentence about the selected route                                                                                        | `summaryLine` for the selected route                  |
| Cards   | One card per route: the typical range, where it sits on the time scale, how many made it                                           | The explore routes                                    |
| Detail  | The selected route in detail: how long it took, what happened to people, what showed up                                            | The selected route's points, outcome shares and lists |
| Footer  | The honesty note: ranges with sample sizes, synthetic cohort, numbers from code, never a promise                                   | Fixed                                                 |

The Compare tab holds the radar, its toggles and the side-by-side table. The
Why tab explains the order, what a range means, what the numbers cannot tell
you, and the six measures. A conflict notice appears above the map when the
person's limits leave a route (or every route) with nobody inside them.

## The map explained

The map is a time chart dressed as a star chart. **Distance to the right is
months from today**, marked on a dashed time axis with ticks every 12 months.
"You today" is the node on the left; each route is a thin curved line that
fans out to its own lane.

- **Each route is a line to a star at its median.** The star sits at the
  route's median months to the goal, so a slower route ends further right.
- **The soft band is the typical window**, from P25 to P75 of months to the
  goal, drawn as a wide soft stroke along the line.
- **Star size is how many engineers made it**: radius runs from 5 to 9 pixels
  on a square-root scale, so the biggest crowd gets the biggest star and a
  small crowd still gets a visible one.
- **Hollow and dashed means limited evidence**: routes with fewer than 15
  comparable engineers draw a hollow star and a dashed line.
- **The dashed gold line is the person's time limit**, and the hatched region
  past it is "too late for you".
- **A route nobody finished within the limits becomes a faint dotted ghost**
  ending in a small crossed marker where the fastest engineer finished,
  outside the limit. A route with no comparable engineers at all is a small
  hollow circle with a "No data" label.

Layout rules, computed purely in `mapLayout.ts` and tested without a browser:

- The axis starts at Today (month 0) and rounds up to whole years (multiples
  of 12 months), with a floor of 36 months, and stretches to include the
  longest window, the fastest ghost finish, or the person's limit.
- Lanes run top to bottom in climb, jump, pivot order.
- The background stars are deterministic (a seeded generator), so the server
  and the browser draw the same sky.

## Route statuses

Every route is in exactly one of four states. The rule looks at the sample
size, whether anyone finished within the limits, and whether the evidence is
thin.

| Status               | Rule                                                            | Badge                   | Card                                                                  | Map                                      | Sentence                                                                                                      |
| -------------------- | --------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ok`                 | 15+ engineers, some finished                                    | none                    | The range, the scale, the success meter                               | Solid star, band, solid line             | "Usually 34–40 months. 74–92% got there. Based on 55 engineers."                                              |
| `limited`            | Fewer than 15 engineers, some finished                          | Limited evidence        | As above, plus an amber tag                                           | Hollow star, dashed line                 | As above, plus "Limited evidence."                                                                            |
| `none_within_limits` | Engineers exist and some reached it, but none within the limits | None within your limits | Grey card: "Not within your limits", the share and the fastest finish | Faint dotted ghost at the fastest finish | "No comparable engineer reached it within your limits (55 comparable engineers). The fastest took 30 months." |
| `no_data`            | No comparable engineers                                         | No comparable engineers | Grey card: "No data"                                                  | Small hollow circle, "No data"           | "No comparable engineers matched, so there is no evidence for this route."                                    |

## The cards, the spread chart and the outcome bar

Each **card** opens with the route's name, its one-sentence meaning ("Grow
into it step by step where you are") and its tags ("Start here" for the
recommended route, or a status badge). Then the big typical range, a bar
showing where that range sits on the 0-to-axis scale with a tick for the
median, the success range with its own 0–100% meter, and the facts: how many
comparable engineers, how many made it, and the pay band reached.

The **spread chart** ("How long it took") shows every comparable engineer who
reached the goal as 3-month bins: a bar for each bin, the typical window
shaded behind the bars, a marker for the median, and the person's limit as a
gold line. Engineers who reached the goal but outside the limits stack in grey
("Reached it, but later"). The domain zooms to the data (never narrower than
24 months) so a tight cluster does not fill the whole width.

The **outcome bar** ("What happened to N comparable engineers") is one bar
that always adds to 100%: reached it (within the limits when limits apply),
reached it but outside the limits, stalled, left the field. Whole percentages
use largest-remainder rounding so the shares add to exactly 100. A legend
under the bar repeats every share in words.

## Compare and Why

**Compare** puts the three routes side by side on six measures, each an
absolute 0–100 score where higher is always better: Pay, Speed, Odds,
Learning, Balance, Stability. Three are direct measurements (pay band
reached, speed from median months, odds from the success interval) and three
are proxies the cohort lets us measure (learning from company moves, balance
from remote share, stability from staying in the field); the Why tab says
exactly which is which. The radar draws one polygon per route with toggles to
hide routes, and the table lists typical time, success, pay band, evidence
and all six scores, highlighting the best score in each row (ties highlight
every tied cell).

**Why** ("How to read this") explains why the routes are ordered the way they
are, what a range means (success is a 95% interval, time is the middle half),
what the numbers cannot tell you (how many comparable engineers never reached
the goal, and that real-world success may be lower because struggling people
share less), and the plain-language definition of each of the six measures.

## Accessibility

- **Tabs** use the tablist pattern: `tab` roles, `aria-selected`, a tab panel
  tied with `aria-labelledby`, roving tabindex and left/right arrow keys.
- **Every drawing has a text equivalent**: the map has a legend, a caption
  sentence and a full spoken sentence per route; range bars and meters have
  `aria-label`s; the spread chart has an `aria-label` summary plus a
  figcaption; the outcome bar has an `aria-label` plus a legend; the radar has
  a spoken description of all six scores plus the compare table.
- **The route buttons**: cards are real buttons with `aria-pressed`, and map
  lanes are keyboard-focusable with Enter/Space to select.
- **Reduced motion** turns off shimmer and transitions; **light and dark**
  themes follow the system (the map panel is a night sky in both).
- **The phone layout** renders a separate compact map below 720 px and hides
  the desktop one with `display: none`, so a screen reader reads only one map.
  Colour is never the only signal: every route is named and every status has
  words.

## Honesty in the interface

Ranges carry sample sizes everywhere ("Based on 55 engineers", "n=55",
"47 made it"). The cohort is labelled synthetic in the hero, the Why tab and
the footer. Thin evidence is called out in badges, sentences and map
hollowness. The footer and the Why tab both say it plainly: this is a planning
aid, not a promise.

## Design system

| Area                       | Choice                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| Route colours, on the map  | Climb `#7DB4FF`, Jump `#FF9F8F`, Pivot `#B7A6FF`                                 |
| Route colours, on the page | Climb `#3B82F6`, Jump `#EF6A52`, Pivot `#7C5CFF`                                 |
| Limit and goal gold        | `#F2C76E`                                                                        |
| Type                       | Geist (Next.js font integration), tabular numerals                               |
| Spacing and radius         | 18 px card radius, 16–28 px gaps, pill chips and tags                            |
| Themes                     | Light by default, dark via `prefers-color-scheme`; the map is always a night sky |

All of it lives in `src/app/globals.css`, in one file: variables at `:root`,
component styles, the 860 px and 720 px breakpoints, and the reduced-motion
block.

## Files

| File                               | What it is                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/components/PathApp.tsx`       | The screen: fetches from `explore`, holds tab and selection state, renders every tab        |
| `src/components/Constellation.tsx` | The map: paints desktop and compact SVGs from the layout                                    |
| `src/components/RouteCard.tsx`     | One route card: range, scale, success meter, facts                                          |
| `src/components/Charts.tsx`        | Range bars, success meters, the spread chart, the outcome bar                               |
| `src/components/RadarChart.tsx`    | The six-axis compare radar                                                                  |
| `src/components/Panels.tsx`        | The detail section, the Compare tab and the Why tab                                         |
| `src/ui/format.ts`                 | All wording: ranges, statuses, badges, the plain sentence, share rounding                   |
| `src/ui/mapLayout.ts`              | All map geometry: axis, lanes, windows, stars, limits, the sky                              |
| `src/ui/histogram.ts`              | Spread-chart binning (3-month bins) and the zoomed domain                                   |
| `src/ui/radar.ts`                  | Radar geometry: axes, polygons, grid rings                                                  |
| `src/ui/palette.ts`                | Route colours for the map and the page, and the goal gold                                   |
| `src/ui/sample.ts`                 | The sample person the app opens with, plus role and region labels                           |
| `src/lib/engine/distribution.ts`   | Every comparable engineer who reached the goal, per route, with whether they met the limits |

## How the visual check works

`scripts/render-preview.tsx` renders the real components to static HTML files
for a browser to open, with no server:

```sh
npx tsx scripts/render-preview.tsx /tmp/preview
```

It writes five files: `map.html`, `compare.html`, `why.html`,
`limited.html` (a 24-month limit) and `phone.html` (the map inside a narrow
frame). Each file is self-contained: the real CSS and the real markup from the
same components the app uses.

## Live evaluation

Results of the live evaluation are added by the maintainer after measurement.

## Known limits

- The map shows the median arrival, not the steps: the steps arrive with the
  Planner's plan in a later part.
- The first render fetches from the server; until the answer arrives there is
  only the loading skeleton.
- The phone layout shows less text per lane than the desktop map.
- Distribution charts show only engineers who reached the goal; stalled and
  left-field shares live in the outcome bar.

## How to verify

```sh
npm run check   # typecheck, lint, format check, tests, secret scan
npm run build   # the production build, including its own typecheck
npx tsx scripts/render-preview.tsx /tmp/preview   # static HTML previews for a browser
```

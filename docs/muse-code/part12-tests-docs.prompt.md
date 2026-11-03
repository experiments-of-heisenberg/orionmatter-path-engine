# Task: extra tests, a bug hunt and a docs page for Part 12, the Path Map and Compare interface (tests and docs only)

Read AGENTS.md first and follow it. Part 12 added the interface: src/components/*.tsx (PathApp with the pure PathView, Constellation,
Charts, RouteCard, RadarChart, Panels), src/ui/*.ts (format, mapLayout, histogram, radar, palette, sample), src/lib/engine/distribution.ts,
and src/app/globals.css, layout.tsx, page.tsx. It is implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION.
You must NOT change any file under src/, evals/, scripts/ or next.config.ts.

## Read first (do not edit)
All of the above, plus the existing tests: tests/uiFormat.test.ts, uiMapLayout.test.ts, uiCharts.test.ts, uiRender.test.tsx, distribution.test.ts,
tests/helpers/ui.ts (exploreFor, embeddedPerson). The view renders to static HTML with react-dom/server's renderToStaticMarkup, so test it that way;
there is no browser and no jsdom. Do NOT duplicate what exists; add what is missing.

## Create these test files (Vitest, deterministic, offline)

1. tests/uiFormatEdges.test.ts
   - monthsRange and percentRange with 0, equal ends, ends that round the same, fractions like 0.005 and 0.995, and values above 1 (state what happens);
     bandRange with one end "-" and one real band (state it); roundedShares with NaN, negative values and a single share (state what happens; report any crash).
   - routeStatus for a hand-built route with n 0; with n > 0 and reachedN 0 and reachedShare 0 (state: no_data); with reachedN > 0 and thin.
   - summaryLine for a route with monthsToGoal null but reachedN > 0 (state what it prints and report if it prints something misleading).
   - the singular case: a route with n 1 says "Based on 1 engineers" (read the code: report if that grammar bug exists).

2. tests/uiMapLayoutEdges.test.ts
   - a hand-built list of routes with identical values: lanes still have distinct y positions; reachedN all 0: radius handling; a route with monthsToGoal [30,30] (zero-width window): window is
     defined or undefined (state it and whether a zero-width band can render as a dot).
   - very long routes (P75 of 200 months): axisMax is a multiple of 12, ticks count is sane (assert at most 20 ticks or report if it explodes), x stays inside the picture.
   - a limit of 1 month and of 240 months; a limit exactly equal to a route's median.
   - COMPACT layout: label x plus an estimated 60 px text width stays below the width for every real route under several constraints (loop over limits; report any overflow).
   - the Bézier window samples: the window path points are ordered by increasing x; the window never leaves the lane's curve (y between origin y and lane y).
   - none of the numbers in a path string is outside [-50, width+50] x [-50, height+50] for any real scenario (loop).

3. tests/uiRenderEdges.test.tsx (use renderToStaticMarkup and PathView; real data via tests/helpers/ui.ts)
   - the selected route changes the caption, the "in detail" heading, aria-pressed on exactly one card button and one drawn route per layout: loop over the three routes.
   - every unselected drawn route has the lane--dim class and the selected has lane--selected (desktop and phone versions both).
   - the limit label appears only when maxMonths is set; the hatch pattern def ids are unique across the desktop and phone SVGs (ids must not collide in one document).
   - a pay floor with no time limit: no "Your limit" text; cards still correct.
   - the tab panel's id and aria-labelledby match the selected tab for all three tabs.
   - all text that includes user-controlled strings (goal label with <, >, & and quotes; stack skills with markup) is escaped in the output (use a person with a goal label like '<img src=x onerror=alert(1)>' and assert the raw markup does not appear unescaped).
   - the radar toggles: with two routes hidden in the initial state (the component has state; if it cannot be set from outside, test RadarChart directly with a hidden set) only one polygon with data renders.
   - RouteDetail with skills asked about: one line per skill, the "no evidence" wording for an unknown skill, the "ranges overlap" wording, "Limited evidence" for thin groups (use exploreFor with addSkills ["rust","go"]).
   - Compare table: for each axis row exactly one or more cells marked cell--best, and ties mark all tied cells.

4. tests/uiCss.test.ts (read src/app/globals.css as text)
   - every CSS class used in the components' markup (collect class names by rendering all views and extracting class="..." tokens) is defined in globals.css, OR is on an explicit allowlist you write in the test with a reason
     (such as modifier classes that need no style); report any class that is used but never styled.
   - the file defines a dark-theme block via prefers-color-scheme and a reduced-motion block, and the custom properties used by var(--...) are all defined at :root (parse var(--name) uses and check each is defined in :root or in the dark block).
   - there is no use of !important except inside the prefers-reduced-motion block.
   - the responsive breakpoints are 860px and 720px and the compact map is hidden by default and shown at 720px.

## Create docs/parts/part-12-path-map-and-compare.md
Plain-language guide for someone new to the project. Include:
- The problem: a person needs to see three routes at a glance, understand how sure we are, and trust the numbers. The map is a picture; the cards and text say the same things in words.
- A description of the screen, top to bottom, with what each part shows and where the data comes from (the instant explore route; no model).
- The map explained: distance is months from today; each route is a line to a star at its median; the soft band is the typical window (P25 to P75); star size is how many engineers made it
  (5 to 9 pixels radius by square-root scale); hollow and dashed means limited evidence (fewer than 15 engineers); the dashed gold line is the person's time limit and the hatched region is "too late for you"; a route nobody
  finished within the limits becomes a faint dotted ghost ending where the fastest engineer finished, outside the limit. Include the layout rules from mapLayout.ts (axis rounds up to whole years, floor 36 months).
- A table of the route statuses (ok, limited, none_within_limits, no_data): the rule, the badge text, and what the card, the map and the sentence say.
- The cards, the spread chart (3-month bins, zoomed domain, the typical window shading, the limit line, grey for "reached it, but later") and the outcome bar (largest-remainder rounding so shares add to 100).
- Compare: the six measures, the radar, the table, the best-score highlight; and the Why tab.
- Accessibility: tabs with roles and arrow keys, every drawing has a text equivalent (list them), the route buttons, reduced motion, light and dark, the phone layout (a separate compact map shown below 720px; the desktop one is hidden, so a screen reader reads only one).
- Honesty in the interface: ranges with sample sizes everywhere, the synthetic label, "limited evidence" wording, never a promise.
- The design system in a short table: colours (route colours for the map and for the page), type (Geist), spacing/radius, themes.
- A table of the files in src/components, src/ui and the engine's distribution module, one line each.
- How the visual check works: scripts/render-preview.tsx renders the real components to static HTML files (map, compare, why, limited, phone) for a browser to open.
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "Results of the live evaluation are added by the maintainer after measurement." (do not invent numbers).
- Known limits: the map shows the median arrival, not the steps (steps arrive with the Planner's plan in a later part); the first render fetches from the server; the phone layout shows less text per lane;
  distribution charts show only engineers who reached the goal.
- How to verify: npm run check; npm run build; npx tsx scripts/render-preview.tsx /tmp/preview.

## Rules
- BUG HUNT: if you find a bug in src/, do not fix it and do not write a failing test. Describe it in your final message (file, line, what is wrong, a concrete input, suggested fix). Look especially at: wording
  that is wrong for 1 engineer or for 0, a drawn element that can fall outside the picture, duplicated SVG ids across the two map versions, text that could overlap in the compact layout, accessibility problems (a role without a
  name, a button inside a button, tabindex misuse, missing labels, colour used as the only signal), unescaped user text, state that is lost on a tab switch (the Compare toggles live in a component that unmounts), and anything
  that could throw on odd data (a route with n 0 in the histogram or the radar, an empty reachedPoints, maxMonths 1).
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

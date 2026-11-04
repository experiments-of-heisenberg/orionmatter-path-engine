# ADR 0019: Words, not codes, at the last moment

- Status: accepted
- Date: 2026-11-05

## Context

The data, the tools and the agents speak in short codes: levels `L3` to `L7`, `EM1`, `EM2` and pay bands `B1` to `B5`. They are exact,
and every recorded demo answer, every evaluation and most tests are written in them. A person reading the screen does not think in
them: `B4` means nothing, and `L5` means different things at different companies. The first screen also showed more than a first-time
reader can take in, which a judge has a few minutes to do.

## Decision

1. **Translate on the way to the screen, never before.** One module, `src/ui/display.ts`, turns level codes into titles ("Senior
   Engineer") and band codes into indicative pay ranges for the person's region ("₹70 lakh or more (about $85k+)"). Components call
   `h(text)` on the strings they show. The engine, the data, the prompts and the 38 recordings are untouched, so the demo build and
   the live evaluations stay valid and nothing the models see changed.
2. **The pay ranges are labelled for what they are.** `data/pay-bands.json` holds one set of cut points per region, rounded from public
   2026 salary surveys, with its sources. The synthetic cohort only stores the order of the bands, so the screen and the README say the ranges
   are orientation and not cohort data.
3. **Off unless told.** `h` does nothing until the app has set the person's region, so a component rendered on its own and every
   engine test sees the codes as before. A screen sets the region while it renders and clears it when it goes away.
4. **A sweep keeps it honest.** A test walks the demo journey on the recorded answers and fails if a code appears anywhere a person
   reads (text and accessible names), on any tab, after any step. It found a real miss while this was being built. The person's own typed
   words and the quotes taken from them are left as they wrote them.
5. **Declutter by showing less first, not by removing anything.** The three dashed header chips become one quiet line, the map legend sits
   behind "How to read this map", each route card draws one bar instead of two, and "What changed" shows three items with the rest on
   request. All eight tabs keep their names.

## Consequences

- Positive: a judge reads "Senior Engineer" and "₹70 lakh or more", not `L5` and `B4`; nothing the agents or the evals rely on changed.
- Negative: the ranges are rounded from public figures and cannot be right for every employer and city; the screen says so.
- Negative: a free-text sentence with a currency amount ("at least 70 lakh") is not understood by the interpreter, which still reads
  bands. The example buttons and the pay chips cover the common path.
- Negative: model-written prose is converted by pattern. A new phrasing of a code the pattern does not know would show as written;
  the sweep test is how we find out.

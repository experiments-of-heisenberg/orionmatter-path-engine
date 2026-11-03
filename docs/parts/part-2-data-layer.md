# Part 2: Data layer

**Goal:** give the planner trustworthy numbers by computing every figure with small,
deterministic tools over a synthetic cohort — never from model memory.

## What the data layer is

The data layer is a set of pure functions in `src/lib/tools/` that read the generated
datasets in `data/*.json` (484 synthetic career histories, a title-to-level map, and
fictional company markers), which `src/lib/tools/data.ts` loads once into typed constants. Agents call the tools through the `EvidenceLedger`, which
records each call under a unique evidence id so every claim in a plan can cite its source.
Shared contracts live in `src/lib/schemas.ts`, and shared math (percentiles, comp-band
helpers) lives in `src/lib/tools/stats.ts`.

## The five tools

| Tool         | Inputs                              | Outputs                                                                                          | Guarantee it makes                                                                                                                      |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `findTwins`  | Profile, Goal, optional Constraints | Twin ids plus `n`                                                                                | Twins are comparable by construction: same role family, goal level reached, start within one level; `n` always equals `twinIds.length`. |
| `pathStats`  | Twin ids, one archetype             | `n`, `evidenceThin`, reached-rate interval, months P25-P75, comp-band range, top risks and gates | Ranges, never single numbers: success is a confidence interval, timing is a percentile band, always with the sample size.               |
| `levelMap`   | Company name, job title             | Canonical level or null                                                                          | Total function: unknown companies or titles return null instead of guessing.                                                            |
| `compBands`  | Canonical level, region             | `n`, `evidenceThin`, P25/P50/P75 bands                                                           | Bands, not points: pay is an ordered B1-B5 range over engineers who reached the level.                                                  |
| `kAnonymity` | Attribute combination, cohort, `k`  | Pass/fail, group size, offending attributes                                                      | No claim about a too-small group: slices below `k` members fail with the attributes to drop.                                            |

## Edge behaviours (documented in JSDoc, covered in `tests/tools.edge.test.ts`)

- `pathStats` with no matching twins returns `n = 0`, `evidenceThin = true`,
  reached rate `[0, 0]`, `null` months, comp range `["-", "-"]`, and empty lists.
- `pathStats` also returns `null` months (never `NaN`) when twins exist but none reached
  the goal. `NaN` would silently become `null` in JSON and then fail number validation.
- `pathStats` ignores unknown twin ids and counts duplicate ids once.
- `pathStats` reached-rate interval always lies within `[0, 1]` with low ≤ high;
  months percentiles are ordered (P25 ≤ P50 ≤ P75) on large samples.
- `findTwins` matches start levels within one seniority rank (L4 and L5 match an L5
  profile) and excludes levels two away (no L5 twin for an L3 profile). Ranks come from
  `levels.ts`, where EM1 ranks like L5 and EM2 like L6.
- `findTwins` returns no twins for a level that is not on the ladder, rather than guessing.
- `findTwins` with the remote constraint returns only remote engineers.
- `compBands` for an unknown region returns `n = 0`, null bands, `evidenceThin = true`.
- `levelMap` returns null for an unknown company and for an unknown title.
- `kAnonymity` with empty attributes matches the whole cohort and passes; `k = 1`
  passes for any non-empty match; `offendingAttrs` is empty whenever the check passes.
- `kAnonymity` honours a custom cohort passed as the second argument.
- `percentile` returns the single element for a one-element array, interpolates for
  two elements, and returns `NaN` for an empty array.

## How to verify

```bash
npm run check
```

## Findings from the Muse Code run, and what we did

Muse Code wrote the JSDoc, the edge tests and the first draft of this page, then reported
three things it left untouched (it was told not to change behaviour):

| Finding                                                                                           | Verdict      | Action                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findTwins` parsed levels by stripping digits, so EM1 became 1 and a manager matched no engineers | **Real bug** | Added `levels.ts` with an explicit rank table and regression tests (`tests/levels.test.ts`). Confirmed the new tests fail on the old code and pass on the fix. |
| `pathStats` returned `NaN` months when nothing reached the goal                                   | Real hazard  | Now returns `null`, typed as `number \| null`.                                                                                                                 |
| `MARKERS` and the `Step` type were under-typed                                                    | Valid        | `CompanyMarker` interface added; `Step` and `Archetype` types exported.                                                                                        |

Review notes: the compiled output of every source file Muse Code edited was byte-identical
to before (comments only). One header comment (`kAnonymity.ts`) mis-stated the module's
role, saying the planner uses it; it is the Privacy Guard's tool. It was corrected by hand.

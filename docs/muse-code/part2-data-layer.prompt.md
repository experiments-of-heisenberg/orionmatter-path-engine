# Task: polish the data layer (documentation and test coverage only)

Read AGENTS.md first and follow it. This is a documentation and testing task. You must NOT change
the runtime behaviour of any existing function.

## Files you may edit (comments and JSDoc only, no logic changes)
- src/lib/tools/findTwins.ts
- src/lib/tools/pathStats.ts
- src/lib/tools/levelMap.ts
- src/lib/tools/compBands.ts
- src/lib/tools/kAnonymity.ts
- src/lib/tools/data.ts
- src/lib/schemas.ts

## Files you may create
- tests/tools.edge.test.ts  (new edge-case tests)
- docs/parts/part-2-data-layer.md  (plain-language description of each tool)

## Do NOT touch
src/lib/tools/ledger.ts, toolSchemas.ts, stats.ts, index.ts, src/lib/env.ts, existing tests,
data/*, scripts/*, docs/muse-code/*, package.json, any config file.

## 1. Comments and JSDoc
For each file you may edit:
- Make sure it starts with a header comment saying what the module does and why it exists.
- Give every exported function and exported type a JSDoc block: purpose, parameters, return
  value, and any important edge behaviour (for example what happens with an empty input).
- In src/lib/schemas.ts, add a one-line comment on each schema saying what it represents and
  where it is used (Profile = a user's verified-ish position, Constraints = what-if knobs, Claim =
  a single evidence-backed statement, Route = one proposed path, and so on).
- Keep comments accurate. Read the code; do not guess. Do not narrate obvious code.

## 2. Edge-case tests in tests/tools.edge.test.ts
Use Vitest, import from "../src/lib/tools" or the specific module, keep tests deterministic and
offline. Cover at least:
- pathStats: an empty twin set returns n = 0 and evidenceThin = true; the reachedRate interval
  always lies within [0, 1] and low <= high; monthsP25 <= monthsP50 <= monthsP75 when n is large.
- findTwins: the start-level rule (within one level matches, two levels away does not); the remote
  constraint only returns remote engineers; n always equals twinIds.length.
- compBands: an unknown region returns n = 0 with null bands and evidenceThin = true.
- levelMap: unknown company and unknown title both return null.
- kAnonymity: an empty attribute object matches the whole cohort and passes; k = 1 always passes
  for a non-empty match; offendingAttrs is empty when the check passes; a custom small cohort passed
  as the second argument is respected.
- percentile (from src/lib/tools/stats.ts): one element, two elements, empty array returns NaN.

## 3. docs/parts/part-2-data-layer.md
A short page: what the data layer is, a table of the five tools (name, inputs, outputs, the
guarantee it makes such as "ranges not points"), and a list of edge behaviours you documented.

## Rules
- If you believe you found a BUG, do not fix it and do not write a test that fails. Describe it
  in your final message (file, line, what is wrong, a suggested fix) and leave the code as is.
- Run `npm run check` at the end. It must pass. Report its final result honestly.
- Do not commit. Do not run git commands that change history.
- Final message: list every file you changed or created, and any bugs or doubts you found.

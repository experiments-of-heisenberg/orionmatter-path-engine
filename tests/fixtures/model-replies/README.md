# Real model replies that failed JSON parsing

Captured on 3 Nov 2026 from live Muse Spark composition calls (`scripts/debug-planner-failures.ts`).
They contain only synthetic-cohort plan text, no user data. They are regression fixtures for
`parseModelJson` (tests/json.test.ts):

- `stray-tail-*.txt`: a complete document followed by junk tokens and an unclosed bracket
  (`...}]} %}`, `...}]} mutated]}`). The parser recovers these, conservatively.
- `misplaced-brace-*.txt`: an extra `}` in the middle of the document (`[]}}]}`). The parser must
  NOT recover these: guessing the intent would be unsafe. They go to the repair retry instead.

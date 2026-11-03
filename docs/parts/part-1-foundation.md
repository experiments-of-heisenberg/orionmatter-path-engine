# Part 1: Engineering foundation

**Goal:** make quality automatic before any feature work, so every later part inherits it.

## What was added

| Area                  | Files                                             | What it gives us                                                                                                  |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Strict type safety    | `tsconfig.json`                                   | `strict` plus `noUncheckedIndexedAccess`, unused-code checks. Caught real unsafe array lookups in the data layer. |
| Linting               | `eslint.config.js`                                | Type-aware rules, including no floating promises and no unsafe `any`.                                             |
| Formatting            | `.prettierrc.json`, `.editorconfig`               | One consistent style, enforced by `npm run format:check`.                                                         |
| Validated config      | `src/lib/env.ts`, `.env.example`                  | Fail-fast, typed environment; error messages never contain secrets.                                               |
| Typed evidence ledger | `src/lib/tools/ledger.ts`, `toolSchemas.ts`       | Tool calls validated with Zod; model-supplied calls go through `callUntrusted`.                                   |
| Secret safety         | `scripts/scan-secrets.sh`, `.githooks/pre-commit` | Blocks accidental key commits locally and in CI.                                                                  |
| CI                    | `.github/workflows/ci.yml`                        | Typecheck, lint, format, tests, secret scan, dependency audit on every push.                                      |
| Decisions             | `docs/adr/0001` to `0003`                         | Why the architecture, toolchain and Muse Code safety model are the way they are.                                  |
| Agent rules           | `AGENTS.md`                                       | Project rules that Muse Code loads on every run.                                                                  |

## Notable changes to existing code

- `EvidenceLedger.call` now returns `{ evidenceId, tool, args, result }` instead of a flattened object, and has a validated `callUntrusted` entry point for model-supplied calls.
- Band lookups go through a clamped `bandAt()` helper so an out-of-range index can never return `undefined`.
- The diagnostic scripts share typed helpers in `scripts/lib/` instead of duplicating untyped fetch code.

## How to verify

```bash
npm run check
```

## Muse Code involvement

`AGENTS.md` was scaffolded by `muse init` and then extended by hand with the project rules.
No other Muse Code contributions yet; Part 2 is its first real task.

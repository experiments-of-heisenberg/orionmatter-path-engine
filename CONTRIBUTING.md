# Contributing

## Workflow

1. `npm install` (also enables the git hooks).
2. Make a focused change with tests.
3. `npm run check` must pass: typecheck, lint, format check, tests, secret scan.
4. Commit with a Conventional Commit message (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).

## Standards

- TypeScript strict, no `any`; validate every external input with Zod.
- Every file has a header comment; every exported function has JSDoc.
- Tests are deterministic and offline. Live model calls belong only in `scripts/`.
- Record significant decisions as an ADR in `docs/adr/`.
- If Muse Code wrote part of a change, say so in the commit trailer (`Assisted-by: Muse Code`) and keep its evidence in `docs/muse-code/`.

## Security

Never commit secrets. See ADR 0003. Report suspected leaks by rotating the key first.

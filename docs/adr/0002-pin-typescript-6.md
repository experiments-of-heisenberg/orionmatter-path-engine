# ADR 0002: Pin TypeScript to 6.0.x

- Status: accepted
- Date: 2026-11-03

## Context

`npm install` resolved TypeScript 7.0.2, but `typescript-eslint` 8.72.1 declares a peer
dependency of `typescript >=4.8.4 <6.1.0`. Forcing the install (`--force`) would give a
lint setup that may silently mis-parse code, which defeats its purpose.

## Decision

Pin `typescript` to `~6.0.3`, the newest version inside the supported range, and keep
type-aware linting. Revisit when `typescript-eslint` supports TypeScript 7.

## Consequences

- Positive: a fully supported toolchain with no forced peer dependencies.
- Negative: we do not get TypeScript 7 features or speed until the linter catches up.

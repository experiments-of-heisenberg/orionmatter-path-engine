# ADR 0003: Secret handling and running Muse Code safely

- Status: accepted
- Date: 2026-11-03

## Context

The project needs two API keys (Meta Model API and Baseten) and uses Muse Code, an
autonomous coding agent, which can run shell commands. The build container has no OS
sandbox helper (`bwrap`), so Muse Code's built-in containment cannot run there.

## Decision

- Keys are never committed or pasted into chat. Locally they live in a credential store
  that injects them as environment variables; deployed, they live in the host's secret
  settings. `src/lib/env.ts` is the only code that reads the environment.
- `scripts/scan-secrets.sh` runs in the pre-commit hook and CI to catch accidental commits.
- Muse Code runs through `scripts/muse-run.sh`, which disables its sandbox (acceptable
  only because the container is disposable), gives the process ONLY `META_API_KEY`,
  caps model steps, saves the prompt and a redacted session export as evidence, and
  deletes that evidence if a leak scan finds a key.
- Muse Code's exit code only means the turn finished. Every Muse Code change is reviewed
  and must pass `npm run check` before it is committed.

## Consequences

- Positive: a reviewable evidence trail of Muse Code's contributions with low leak risk.
- Negative: sandbox-off runs rely on the disposable container and on review. This must
  not be copied to a workstation that holds real credentials.

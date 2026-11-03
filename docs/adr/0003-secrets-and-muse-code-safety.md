# ADR 0003: Secret handling and running Muse Code safely

- Status: accepted
- Date: 2026-11-03

## Context

The project needs an API key (Meta Model API; a second key for Baseten was used until ADR 0011 removed that provider) and uses Muse Code, an
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
- Muse Code's "Contributor mode" lets Meta train future models on the prompts, code and
  responses of a run. With an API key the mode is selected by model id, and we found that
  `--contributor-mode off` alone still used `muse-spark-1.3-contributor`. The runner
  therefore pins `--model muse-spark-1.3` (Standard) and the redacted session log is
  checked to confirm which model actually served the run. Opting in requires setting
  `MUSE_RUN_CONTRIBUTOR=on` explicitly.
- Muse Code's exit code only means the turn finished. Every Muse Code change is reviewed
  and must pass `npm run check` before it is committed.

## Disclosure

The first Muse Code task (Part 2, data-layer docs and tests) ran before this safeguard
existed, on `muse-spark-1.3-contributor`. Its inputs were this project's own source code,
`AGENTS.md` and the task prompt. All of it is destined for a public repository, and no
keys or personal data were involved. Later runs use Standard mode.

## Consequences

- Positive: a reviewable evidence trail of Muse Code's contributions with low leak risk.
- Negative: sandbox-off runs rely on the disposable container and on review. This must
  not be copied to a workstation that holds real credentials.

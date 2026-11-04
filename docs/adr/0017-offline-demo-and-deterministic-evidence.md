# ADR 0017: A demo that runs without a key, and evidence ids that make a run repeatable

- Status: accepted
- Date: 2026-11-04

## Context

Judges and visitors may open the app with no key, on a link that must not burn the project's model budget, and possibly while
the model API is slow. A live-only demo fails all three. The project already had a fixture mechanism (record live answers,
replay by a hash of the exact request), but replay needs a request to be _identical_ the second time. A full plan run was not:
the evidence ledger gave each lookup a random id, the Planner's second request contained the first lookup's id, so the second request
never matched a recording.

## Decision

1. **Evidence ids come from the call's content.** `ev_` plus 8 hex digits of a hash of the tool name and its arguments. The same
   question always has the same id, a repeat of the very same call gets a `_2` suffix, and sequential ids do not exist, so a
   model still cannot name a lookup it never made. A test injects its own ids as before. This makes every run reproducible, which also
   makes tests stable, not only replay.
2. **Record the examples, not the world.** `npm run record:demo` drives the same server handlers the browser reaches, against the
   live model, for every one-click example: the example story, the four What if sentences, the plan for the starting limits
   and for the limits each example leads to, and the example privacy text. The recordings are plain JSON in `src/fixtures`
   (about 160 KB) and are committed.
3. **Say it is a replay.** The server's health answer reports its mode; the screen shows "Demo build: replaying recorded
   Muse Spark answers" when it is. A request that was not recorded is refused as `demo_only` with a message that says what to
   do, not as "the model is not configured".
4. **Ship the recordings with the build.** The API routes read fixtures from disk at run time, which Next's file tracing cannot see,
   so `outputFileTracingIncludes` names the folder for every API route. A test reads the config; the built route manifests
   were checked to list every fixture.
5. **A test replays every example**, through the handlers and through the routes, and fails when a text, a prompt or an id changes
   until the recordings are redone.
6. **One smoke script for every environment.** `npm run smoke -- <url> [--model|--plan]` runs the same end-to-end checks against a
   laptop, a preview deploy or production, and exits non-zero on any failure. The checks themselves are tested against servers that are wrong in each way they look for.
7. **Live results are published with their limits.** `docs/evals.md` reports the live suites with their sample sizes, the one
   thing each cannot show, and the raw outputs in `docs/evidence/live`.

## Consequences

- Positive: a visitor with no key sees the full story, including a real Skeptic revision, in seconds and at no cost; every plan run can be reproduced exactly.
- Negative: any change to a prompt, an example text or an evidence id invalidates recordings until they are redone (a test says so). The demo build can only do what was recorded.
- Risk accepted: recorded answers are one sample of the model's behaviour. The live evaluation, not the replay, is what says how the model behaves.

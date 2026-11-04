# ADR 0018: Two deployments from one repository, and documents that are tested

- Status: accepted
- Date: 2026-11-04

## Context

The submission is judged on a link. A link that depends on a live model has three ways to fail in front of a judge: the model is
slow, the key's budget is gone, or a rate limit trips because several judges look at once. A link that never calls the model has
none of those, but hides how much of the product is the model. Separately, the README and the guides are read before the code is,
and they drift: a renamed button, a changed default or a count that is no longer true each cost a point of credibility.

## Decision

1. **Deploy twice from the same repository.** A _live_ project with the key shows Muse Spark working on anything a visitor types;
   a _demo_ project with `USE_FIXTURES=true` and no key replays the recorded answers. The demo project cannot spend anything and
   always answers quickly; the live link is the one in the video. Both say what they are on screen and in `/api/health`.
2. **The pictures in the README are drawn by the app's own components** from the recorded data (`npm run docs:images`), and a test compares
   the committed files with a fresh render. A screenshot taken by hand cannot be checked this way and goes stale silently.
3. **The documents are under test.** Relative links, the `npm` commands they name, the number of ADRs they state, the tabs they list and
   the default model name are checked against the repository.
4. **The honesty rules are a test.** A scan keeps words that overclaim (on-device, open weights, predicts, guarantee, real data, accurate,
   private by default) out of the screens and the judge-facing documents unless the sentence is denying them, and a second check keeps
   any second model provider out of the runtime. The scan's own behaviour is tested with sentences that must and must not be flagged.

## Consequences

- Positive: a judge always reaches a working product; a stale document or an overclaim fails the build instead of reaching a reader.
- Positive: the maintainer's deployment steps are a short, checkable list ([`docs/deploy.md`](../deploy.md)).
- Negative: two projects to keep in sync (they are the same commit, so it is a redeploy), and the demo project shows only the
  recorded examples. We prefer saying so on screen to hiding it.
- Negative: the denial-aware scan is a heuristic: a sentence that overclaims while containing "not" nearby will pass. It catches the
  common mistakes and does not replace reading the text.

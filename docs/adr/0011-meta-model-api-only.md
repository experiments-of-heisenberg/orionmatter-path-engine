# ADR 0011: One model provider, the Meta Model API

- Status: accepted (supersedes the two-provider plan in ADR 0003 and ADR 0004)
- Date: 2026-11-03

## Context

The project began with two targets: Muse Spark on the Meta Model API and Muse Spark Open, an
open-weights model, on Baseten, intended for the Privacy Guard. Part 0 probed both. By Part 9 no agent
called the open model: Planner, Skeptic, What-if and Intake all run on Muse Spark. The maintainer decided
to enter the Indie track on the strength of the product and to leave the open-weights category out.

## Decision

1. **Every model call goes to the Meta Model API (Muse Spark).** The Baseten key, base URL and model id
   are removed from the validated environment, `.env.example`, the client, the scripts and the tests.
   A test pins the exact set of settings so a second provider cannot appear unnoticed.
2. **`ModelTarget` stays as a field with one value.** Removing it would touch every request and change
   fixture keys. Keeping it makes a future provider a visible, reviewed change.
3. **The Privacy Guard runs on Muse Spark** with a deterministic core (k-anonymity and code detectors),
   the model only proposing findings that code then guards.
4. **We make no open-weights claims.** The README and docs do not describe any component as running
   on open weights, on-device or self-hosted.
5. **Part 0's findings stay as history.** `docs/api-notes.md` keeps the Baseten probes, marked as
   historical, because they explain choices such as the JSON repair retry.
6. **Muse Code's environment is scrubbed of every `*_API_KEY` variable except its own**, and the leak
   scan covers all of them, so adding or removing a provider needs no change to that script.

## Consequences

- Positive: one key, one failure mode, one set of behaviours to test and record as fixtures; a simpler
  and more honest story.
- Negative: no open-weights component for judges looking for one. We accept that trade.
- Neutral: the JSON repair retry stays. It was motivated by both models but Muse Spark needs it too.

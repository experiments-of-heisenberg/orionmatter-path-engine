# ADR 0004: Model client design

- Status: accepted
- Date: 2026-11-03

## Context

Every agent calls a hosted model. Live calls are slow, rate-limited, and non-deterministic,
and Part 0 showed two provider quirks: Muse Spark counts hidden reasoning tokens inside
`max_completion_tokens` (a small budget returns an empty reply), and Muse Spark Open has no
guaranteed JSON mode. The demo must also survive a bad network at recording time.

## Decision

1. **One narrow interface.** Agents depend only on `ModelClient.chat()`. Provider details,
   retries and logging live behind it.
2. **Inject every side effect** (HTTP transport, sleep, randomness, clock, logger, fixture
   store). The retry and escalation logic is tested offline with fakes and mutation-checked.
3. **Escalate the token budget** (double, up to 2 times, capped) when a reply is empty and
   the provider reports `finish_reason: "length"`. Other empty replies fail immediately.
4. **Never depend on provider JSON modes.** Structured output is "ask, extract JSON
   defensively, validate with Zod, repair once". It behaves identically on both models.
5. **Fixtures keyed by request content**, recorded live and replayed offline. The key
   excludes labels and timeouts, and keys are never written to disk.
6. **Leave `temperature` and `reasoning_effort` unset unless the caller asks**, per Meta's
   guidance for Muse Spark. Reasoning effort is the cost and latency dial.
7. **Tool arguments are untrusted.** The tool loop feeds bad JSON and tool exceptions back to
   the model as error results, and caps total tool calls (default 8).

## Consequences

- Positive: agents are testable without the network; the demo can run entirely from
  fixtures; a rate limit or reasoning-heavy reply does not crash a run.
- Negative: more code than a bare `fetch`; fixture replay only matches byte-identical
  requests, so changing a prompt means re-recording the affected fixtures.
- Not built (yet): a JSON-action fallback for models without native tool calling. Both models
  passed native tool calling in Part 0 and in the live check, so it would be unused code.

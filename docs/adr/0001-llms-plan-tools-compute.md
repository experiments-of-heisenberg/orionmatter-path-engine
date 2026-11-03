# ADR 0001: LLMs plan and narrate; deterministic tools compute

- Status: accepted
- Date: 2026-11-03

## Context

Orionmatter shows engineers career routes with durations, comp bands and success rates.
Language models are good at composing and explaining, but they invent numbers. A career
tool that shows invented statistics is harmful, and the hackathon rubric rewards
trustworthy engineering.

## Decision

All quantities come from deterministic tool functions over the cohort data. The model
decides which tools to call, composes routes from the results and writes the narrative.
Each tool result is recorded in an `EvidenceLedger` under a unique id. Every claim the
model makes must cite those ids, and a code-based verifier (the first layer of the
Skeptic) rejects claims whose ids are missing or whose numbers do not match the recorded
results. Routes carry percentile ranges and a sample size, never a single score.

## Consequences

- Positive: numbers are auditable; the Skeptic's rejections are real and explainable;
  What-if can recompute instantly without an LLM because the quantities are deterministic.
- Positive: agents are testable offline against a mock model.
- Negative: more code than letting the model answer directly, and routes are limited to
  what the tools can compute.

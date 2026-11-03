# Part 3: Model client

**Goal:** give every agent one simple, safe way to talk to the models — Muse Spark on the
Meta Model API and Muse Spark Open on Baseten — that survives slow networks, rate limits and
empty replies, and that works offline in tests and demos.

## What problem the client solves

Calling a hosted model looks like one HTTP request, but a demo that depends on it has to
handle everything around that request: picking the right provider and model id, timing out a
stuck call, backing off when the API says "slow down", noticing that the model spent its
whole token budget thinking and returned nothing, validating that the reply is really JSON,
running tools the model asks for, and recording calls so the demo still works when the
network does not. The client in `src/lib/model/` does all of that behind one method,
`chat()`, so agents only think about what to ask. Logging lives next to it in
`src/lib/log.ts`, which redacts API keys and keeps message content out of logs.

## The layers

Each layer does one job and delegates the rest downwards. An agent usually enters at
`structured` or `tool loop` level and never sees the layers below.

```text
agent code
   │  chatStructured() : "give me JSON matching this schema" (one repair retry)
   │  runToolLoop()    : "use these tools until you can answer" (capped, evented)
   ▼
client        routing, retries, token-budget escalation, logging, fixture record/replay
   │  wire         our types ⇄ OpenAI-compatible Chat Completions JSON (Zod-validated)
   │  retry        exponential backoff with jitter; server Retry-After wins
   ▼
transport     the only layer that touches the network (fetch + timeout + typed errors)

alongside:  fixtures  record live replies to disk, replay them offline
            mock      scripted fake client for deterministic agent tests
            log       level filtering + secret redaction for every log line
```

## Files in `src/lib/model/`

| File            | What it does in one line                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| `types.ts`      | Provider-independent vocabulary: messages, requests, results, the `ModelClient` interface |
| `client.ts`     | `createModelClient()`: routing, retries, budget escalation, logging, fixtures             |
| `wire.ts`       | Translates our types to/from Chat Completions JSON; validates responses with Zod          |
| `transport.ts`  | `fetchTransport`: POST with timeout; maps failures to typed errors                        |
| `retry.ts`      | Backoff schedule (`maxRetries: 2`, 500 ms base, 8 s cap) and Retry-After parsing          |
| `errors.ts`     | Typed errors so callers branch on the class, never on message text                        |
| `json.ts`       | Pulls a JSON value out of a reply, tolerating fences and surrounding prose                |
| `structured.ts` | `chatStructured()`: schema-validated JSON with one repair retry                           |
| `toolLoop.ts`   | `runToolLoop()`: ask → run tools → repeat, with a cap (default 8) and events              |
| `toolDefs.ts`   | Builds a tool definition from a Zod schema (single source of truth, no `$schema`)         |
| `fixtures.ts`   | Content-keyed record/replay stores (file and in-memory)                                   |
| `mock.ts`       | `createMockClient()`: scripted replies plus `reply` / `callTools` helpers                 |
| `index.ts`      | Public entry point; agents import from here                                               |

## Typed errors and when each is thrown

| Error                     | Thrown when…                                              | Retried?           |
| ------------------------- | --------------------------------------------------------- | ------------------ |
| `ModelHttpError`          | The provider answers with a non-2xx status                | 408, 429, 5xx only |
| `ModelTimeoutError`       | One attempt exceeds its timeout (default 90 s)            | Yes                |
| `ModelNetworkError`       | No HTTP response at all (DNS, refused connection, reset)  | Yes                |
| `ModelAbortedError`       | The caller cancelled via `AbortSignal`                    | Never              |
| `ModelProtocolError`      | A 200 reply is not JSON or lacks the expected shape       | Never              |
| `ModelEmptyResponseError` | The reply is still empty after the budget was escalated   | Never              |
| `ModelConfigError`        | A live call has no API key for its target                 | Never              |
| `FixtureMissError`        | Replay mode has no recording for this request             | Never              |
| `ModelParseError`         | Structured output is still invalid after the repair retry | Never              |

`ModelError` is the base class; its `retryable` flag drives the retry loop. `ModelHttpError`
also carries the status and the parsed `retryAfterMs`. `ModelParseError` keeps the
validation `issues` and the raw `lastText` for debugging (never log the latter blindly:
it may contain user data).

## Fixtures: record once, replay anywhere

Two environment flags in `src/lib/env.ts` control the mode (they must not both be true):

| Flags                  | Mode     | Behaviour                                                                                   |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------- |
| neither set            | `off`    | Every call goes live; nothing is saved.                                                     |
| `RECORD_FIXTURES=true` | `record` | Calls go live (needs real keys) and each response is saved.                                 |
| `USE_FIXTURES=true`    | `replay` | Calls are answered from disk; no network, no keys needed. A miss throws `FixtureMissError`. |

A fixture is keyed by a SHA-256 hash of the request _content_ — target, model, messages,
tools and generation settings — so the same question always finds the same recording. The
human `label`, timeouts and abort signals are excluded from the key, and API keys are never
written to disk. `FileFixtureStore` keeps one JSON file per fixture under `src/fixtures/`
named by the first 16 hex characters of the key (with a full-key check on read);
`MemoryFixtureStore` is the same idea in memory for tests. The mode can also be forced per
client with the `fixtureMode` dependency, which is how tests record-then-replay without
touching the environment.

## How to use the client from an agent

Agents import the interface and helpers from `src/lib/model/` and never touch HTTP:

```ts
import { z } from "zod";
import { getEnv } from "../env";
import { createLogger } from "../log";
import { chatStructured, createModelClient, runToolLoop, toolDefinition } from "../model";
import { EvidenceLedger, ToolArgSchemas } from "../tools";

const env = getEnv();
const client = createModelClient(env, { logger: createLogger({ level: "info" }) });
const ledger = new EvidenceLedger();

// 1. Validated JSON back, with one automatic repair retry on bad output.
const Parsed = z.object({ level: z.string(), years: z.number() });
const parsed = await chatStructured(
  client,
  {
    label: "intake:parse",
    target: "spark",
    reasoningEffort: "low",
    messages: [{ role: "user", content: "Extract …" }],
  },
  Parsed,
);

// 2. Let the model call a deterministic tool until it can answer.
const loop = await runToolLoop({
  client,
  request: {
    label: "planner:round1",
    target: "spark",
    tools: [
      toolDefinition(
        "findTwins",
        "Find comparable engineers in the synthetic cohort.",
        ToolArgSchemas.findTwins,
      ),
    ],
    messages: [{ role: "user", content: "How many twins …? Use findTwins." }],
  },
  // Model-supplied calls go through the ledger: it validates the tool name and arguments.
  execute: ({ name, args }) => {
    const outcome = ledger.callUntrusted(name, args);
    return JSON.stringify(outcome.ok ? outcome.evidence : { error: outcome.error });
  },
});
```

Rules agents follow: every number shown to a user comes from a tool result, never from model
text; tool arguments are untrusted JSON (bad arguments and tool exceptions are fed back to
the model as error results, not crashes); reasoning effort is the cost dial (`minimal`/`low`
for simple extraction, higher for planning).

## Design decisions

**The token budget escalates because Muse Spark counts hidden reasoning against it.**
Part 0 probing (see `docs/api-notes.md`) showed a 200-token budget returning an _empty_
reply: 198 tokens went to reasoning the caller never sees. So when a reply has no text and
no tool calls _and_ the provider reports `finish_reason: "length"`, the client doubles the
budget (default 4000, up to 2 escalations, capped at 16000) and retries. An empty reply
with any other finish reason throws `ModelEmptyResponseError` immediately — a bigger
budget would not help.

**Temperature is left unset.** The client only sends `temperature` when the caller sets it,
because Meta recommends Muse Spark's default of 1.0. `reasoning_effort` is likewise omitted
unless requested.

**Every side effect is injected.** HTTP, sleeping, randomness, the clock, logging and the
fixture store are all constructor dependencies with production defaults, so the retry,
backoff and escalation logic is unit-tested offline with fakes: scripted transports answer
with canned responses, a recording `sleep` captures delays, and `random: () => 0.5` makes
jitter exact. The mock client goes one step further, letting agent tests script whole
conversations without even a fake transport.

## Live verification

Unit tests use fakes. `scripts/live-client-check.ts` runs the real client against both live
models (`npm run live:client`, with both API keys exported as in `.env.example`). Result on 3 Nov 2026,
7 of 7 checks passing, with the redacted logs scanned for key leaks (none):

| Check                                          | Spark (Meta API)                                   | Spark Open (Baseten)              |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| Starved 200-token budget                       | Escalated automatically (2 attempts), replied "OK" | Replied on first attempt          |
| Structured output (Zod)                        | Valid on first try                                 | Valid on first try                |
| Tool loop with real `findTwins` via the ledger | 1 call, reported the true n = 150                  | 1 call, reported the true n = 150 |
| Fixture record then replay                     | Replayed with the API unreachable                  | (same code path)                  |

## Findings from the Muse Code run, and what we did

Muse Code wrote 47 of the tests here and this page's first draft, and found no bug. It raised
one doubt, which was valid: `stableStringify` serialised an `undefined` array item as an empty
string, so `[]` and `[undefined]` produced the same fixture key. Harmless for typed requests,
but a latent collision. It now serialises as `null` (like `JSON.stringify`) and is tested.

The usage example originally called an undefined helper; it now uses the real `EvidenceLedger`.

## How to verify

```bash
npm run check
```

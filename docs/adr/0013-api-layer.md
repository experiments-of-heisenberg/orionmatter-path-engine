# ADR 0013: One guarded door to every agent, streaming over SSE

- Status: accepted
- Date: 2026-11-04

## Context

The browser needs to reach intake, planning, What-if, the privacy check and the instant explore path.
A plan takes 25 to 60 seconds, so the person must see progress while it runs. The model key is paid and
the demo will be public, so a loop or a casual abuser must not be able to spend it. Everything from the
browser is untrusted.

## Decision

1. **Routes are plain `(Request) => Response` functions** built by one wrapper, `defineRoute`. No route
   can forget a guard, every failure has one shape, and tests call routes directly with a scripted model:
   no server, no network, no key.
2. **Guards in a fixed order:** rate limit, size-limited read (header and stream), JSON content type,
   strict Zod schema, concurrency gate. Schemas are `strict()`, so a misspelt or extra field is an error,
   and they reuse the engine's own schemas so the API cannot accept what the engine rejects.
3. **Server-Sent Events for long runs**, not WebSockets: the work is one request with one answer and
   progress along the way. A stream is `open`, progress events, then exactly one `result` or `error`; a
   heartbeat keeps proxies from closing it. Instant routes (explore, privacy) return plain JSON.
4. **A disconnected browser stops the run.** The event emitter throws once the client has gone, which
   aborts the agent at its next event, so a closed tab does not keep spending model calls. The stream always
   closes and the concurrency slot is always released.
5. **Typed errors with stable codes.** Everything thrown below the API is mapped to a code, an HTTP status
   and a message a person can read. Unknown errors are a generic 500 to the browser and detailed only in the
   log. Provider text never reaches the browser.
6. **The browser gets what it needs to draw and explain, not internals:** no twin id lists, no raw ledger.
   Every figure keeps its evidence id.
7. **Logs carry no content.** One line per request with request id, route, status, duration and an anonymous
   client label; keys redacted by the logger the server builds.
8. **Say what the limits are.** Counters are in memory, per server instance: a best-effort guard for the
   key, not a global quota. `x-forwarded-for` is trusted only because the hosting platform sets it. There is
   no authentication; the public demo is protected by the limits alone.

## Consequences

- Positive: one place to read to know every guard; the same pipeline is tested without a network; a verified
  live run over real HTTP (plan in 25.7 s) matches the tested behaviour.
- Negative: on a serverless host each instance has its own counters, so a determined abuser could exceed the
  intended rate. A shared store is the fix and is out of scope for the hackathon.
- Negative: SSE on serverless has platform time limits; the plan route sets `maxDuration` 300 and the longest
  live run so far took under a minute.

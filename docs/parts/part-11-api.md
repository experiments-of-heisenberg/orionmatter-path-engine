# Part 11: The API layer

**Goal:** give the browser one safe door to every agent, with guards the agents
never have to think about, and live progress while a plan is built.

## The problem

Until now the agents were library code: a caller passed typed objects and got
answers back. A browser is a different caller. It sends untrusted bytes over
the network, many browsers arrive at once, each pays for model calls with our
key, and a full plan takes long enough that the person should see progress
instead of a spinner. The API layer solves that once, in one place: every
route goes through the same wrapper (`defineRoute` in
`src/lib/api/route.ts`), which rate-limits, reads, validates, admits, runs and
logs the request the same way. The agents themselves change not at all; they
still receive validated objects and still emit progress events.

## The request pipeline

```
request
  -> rate limit            (rate_limited 429)
  -> size-limited read     (unsupported_media_type 415, payload_too_large 413,
                            invalid_request 400 when the JSON itself is broken)
  -> Zod validation        (invalid_request 400, with field-level issues)
  -> concurrency gate      (busy 503, model routes only)
  -> run                   (model_unavailable 503, model_unreadable 502,
                            not_configured 503, invalid_request 400,
                            internal 500, client_closed when the browser left)
  -> one JSON response, or an event stream ending in result or error
```

The rate limit runs first so a flood of huge bodies cannot even spend our
bandwidth twice; the size check runs before parsing so a giant body cannot
spend our memory; validation runs before the concurrency gate so a bad request
never takes a model slot. (One consequence: a request refused with `busy` has
already spent one rate-limit hit, because the limiter runs first.)

## Endpoints

| Method and path     | What it does                                                               | Request body fields                                                              | Response | Model?                                   | Limiter | Body limit |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- | ---------------------------------------- | ------- | ---------- |
| `POST /api/intake`  | Read words or a screenshot into a draft profile                            | `text?`, `imageDataUrl?`, `previous?` (`draft` + `provenance`)                   | stream   | yes                                      | model   | 6 MB       |
| `POST /api/plan`    | The full Planner + Skeptic run                                             | `profile`, `goal`, `constraints?`                                                | stream   | yes                                      | plan    | 64 KB      |
| `POST /api/explore` | The fast model-free path: fact sheet, tornado, smallest changes, conflicts | `profile`, `goal`, `constraints?`                                                | JSON     | no                                       | light   | 64 KB      |
| `POST /api/whatif`  | Interpret a sentence, recompute, diff, explain                             | `message`, `current?`, `profile`, `goal`, `history?` (up to 3 turns), `narrate?` | stream   | yes                                      | model   | 64 KB      |
| `POST /api/privacy` | How identifying is this profile and story?                                 | `profile`, `goal`, `text?`, `companyType?`, `k?`, `useModel?`                    | JSON     | yes, unless `useModel: false` or no text | model   | 64 KB      |
| `GET /api/health`   | Is the server up, and in which mode?                                       | none                                                                             | JSON     | no                                       | none    | —          |

Limits at the door match the agents' own: a What-if `message` is at most 500 characters,
privacy `text` at most 3000, intake `text` at most 6000, an image data URL about 4 MB, and
`constraints.addSkills` at most 5 entries of 1 to 40 characters. A request over a limit is refused with
field-level `issues` before any model work is spent.

`constraints` and `current` default to `{ riskTolerance: "medium",
addSkills: [] }` when omitted. Health answers without going through the
guards: `{ ok, mode, model, keyConfigured, cohort }`, where `mode` is `live`
or `fixtures` and `keyConfigured` is only ever a boolean, never the key.

All six routes run on the Node.js runtime (`runtime = "nodejs"`) and are
always dynamic (`dynamic = "force-dynamic"`). The slow routes also declare a
platform time budget: plan 300 s, intake and whatif 120 s each, privacy 60 s.

## Stream events

The three streaming routes (`intake`, `plan`, `whatif`) answer with
Server-Sent Events. The rule is simple: **a stream ends with exactly one
`result` or one `error`, then the connection closes.**

| Event         | Data                                              | Meaning                                                    |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `open`        | `{ requestId }`                                   | The stream started; matches the `X-Request-Id` header      |
| `stage`       | `{ type: "stage", stage, round? }`                | The run moved to a new stage (see below)                   |
| `tool_call`   | `{ id, name, args, by }`                          | An agent step started (`by` is `agent` or `engine`)        |
| `tool_result` | `{ id, name, summary, isError, by, evidenceId? }` | That step finished, with the evidence id it earned         |
| `note`        | `{ message }`                                     | A human-readable aside from the run                        |
| `verdict`     | `{ round, approved, rejections, notes }`          | The Skeptic judged a plan draft                            |
| `result`      | the route's answer                                | Success; the last event                                    |
| `error`       | `{ code, message, retryAfter?, issues? }`         | Failure, in the same shape as a JSON error; the last event |
| `: ping`      | (a comment line, no event)                        | Heartbeat every 15 s so quiet proxies keep the connection  |

The stage names are: `reading`, `protecting`, `interpreting`, `explaining`,
`gathering`, `composing`, `auditing`, `revising`, `done`. Not every route
visits every stage: intake reads, privacy protects, whatif interprets and
explains, plan gathers, composes, audits and revises.

## Errors

Every failure, from a mistyped field to a model outage, becomes one of these
stable codes. The browser can switch on `code`; the `message` is safe to show
a person.

| Code                     | HTTP | When it happens                                                       | What the browser should do                                     |
| ------------------------ | ---- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `invalid_request`        | 400  | Bad JSON, a body that fails the schema, or input an agent refuses     | Fix the input; `issues` names the fields (values never echoed) |
| `payload_too_large`      | 413  | The body is over the size limit                                       | Send less (shorter text, smaller image)                        |
| `unsupported_media_type` | 415  | The request was not `application/json`                                | Fix the request code                                           |
| `rate_limited`           | 429  | Too many requests from this client; `retryAfter` says how long        | Wait, then retry                                               |
| `busy`                   | 503  | All model slots are in use (`retryAfter: 5`)                          | Retry shortly                                                  |
| `model_unavailable`      | 503  | The model timed out, was unreachable, or answered an HTTP error       | Retry shortly; honour `retryAfter`                             |
| `model_unreadable`       | 502  | The model answered but its output failed validation (`retryAfter: 2`) | Retry                                                          |
| `not_configured`         | 503  | No API key on the server, or no fixture for this call                 | Tell the operator; retrying will not help                      |
| `client_closed`          | 499  | The browser went away mid-run                                         | Nothing; the request was cancelled                             |
| `internal`               | 500  | Anything else                                                         | Retry once; report it if it persists                           |

`toApiError` (in `src/lib/api/errors.ts`) is what turns a thrown error into a
code: input errors from the agents keep their person-friendly message as
`invalid_request`; `ZodError` becomes `invalid_request` with issues;
`ModelParseError`, `ModelProtocolError` and `ModelEmptyResponseError` (an answer that arrived but cannot be used) become `model_unreadable`; missing configuration or a
missing fixture becomes `not_configured`; HTTP, timeout and network model
failures become `model_unavailable` (using the provider's `Retry-After` when
it sent one, else 5 s); a cancelled request becomes `client_closed`. Anything
`toApiError` does not recognise becomes a generic `internal`: the browser
sees only "Something went wrong on our side.", and the detail goes to the
server logs, where the operator can read it. Status 499 is a logging
convention (a closed client never sees a response); over the wire it is sent
as 400.

## The guards in detail

- **Content type.** Anything that is not `application/json` is refused with
  415 before a single byte is read.
- **Size limits.** 64 KB for ordinary routes, 6 MB for intake (a 4 MB image
  is about 5.4 million base64 characters). The limit is enforced twice: from
  the `Content-Length` header, which rejects early, and while reading, since
  a client can lie about or omit the header. Reading stops the moment the
  limit is passed.
- **Strict schemas.** Every request schema is Zod `strict()`: an unknown or
  misspelt field is a 400, never silently ignored. The API reuses the
  engine's own `Profile`, `Goal` and `Constraints` schemas, so the API can
  never accept something the engine would reject.
- **Rate limiter.** A sliding window per client: 12 requests a minute by
  default. Plan, which makes several model calls, gets a third of that (4);
  the deterministic routes get ten times (120), because sliders call them on
  every change.
- **Concurrency gate.** At most 6 model runs in flight at once by default.
  JSON routes hold a slot for the run; streamed routes hold it until the
  stream ends. Every path releases its slot, including failures and
  abandoned streams.
- **The honest limit.** Both counters live in server memory, so each server
  instance has its own: they stop loops and casual abuse, not a determined
  flood across instances. A real quota belongs in a shared store. Likewise
  the client address comes from `x-forwarded-for`, which is trusted only
  because the hosting platform sets it.

## What the browser never receives

No twin id lists (150 ids per plan), no raw ledger, no error detail text, no
keys. What it gets instead is traceability without bulk: every route carries
the evidence ids behind its numbers, and every plan carries a one-line
summary per tool call (`evidenceId`, `tool`, `summary`), so the interface can
show where each number came from and the Skeptic's checks stay verifiable.

## Logging

One line per request: the request id, the route name, the status, the
milliseconds, and an anonymous 8-hex-character client label (a hash of the
address, so the address itself is never logged). Bodies are never logged.
Unexpected errors log their detail for the operator, and the configured API
key is redacted if it ever appears in an error message.

## Disconnects

A consumer that stays connected but never reads is treated the same way: once 500 chunks are
waiting unread (a run emits a few dozen events), the stream is closed and the run stops, so one idle
connection cannot make the server buffer without limit.

If the browser closes a stream, the next event the run tries to send throws:
the run stops there instead of spending further model calls for nobody, the
outcome is logged as closed-by-client, and the concurrency slot is freed.
Abandoning a `plan` stream halfway therefore costs at most the calls already
made.

## The browser client

`src/lib/api/client.ts` is how the browser calls the API: `postJson` for the
instant routes, `streamPost` for the streaming ones. Both turn every failure
(an HTTP error, an `error` event, a dropped connection) into one
`ApiClientError` with a stable code, so the interface has a single place to
decide what to show. `client.ts` and `sseClient.ts` are free of server imports, so they bundle for the browser (a test builds them with `platform: "browser"` to keep it so). `ApiClientError.retryable` is true when trying again
later makes sense. On top of the server's codes the client adds three of its
own: `network` (unreachable, or broke mid-stream), `stream_ended` (the
connection closed before the answer arrived) and `bad_response` (the server
answered something unusable). Aborts pass through as `AbortError` so the
caller can tell cancel from failure.

```ts
// From a page under src/app/; adjust the relative path to your component.
import { ApiClientError, postJson, streamPost } from "../../lib/api/client";

// One JSON answer.
const sheet = await postJson<{ ranking: { recommended: string | null } }>("/api/explore", { profile, goal });

// A stream: progress as it arrives, then the result.
try {
  const plan = await streamPost<{ status: string }>(
    "/api/plan",
    { profile, goal },
    {
      onEvent: (event) => {
        if (event.kind === "agent" && event.event.type === "stage") {
          console.log("stage:", event.event.stage);
        }
      },
    },
  );
  console.log("plan status:", plan.status);
} catch (error) {
  if (error instanceof ApiClientError && error.retryable) {
    console.log("try again in", error.retryAfter ?? "a few", "seconds");
  } else {
    throw error;
  }
}
```

## Environment settings

Four names matter here: `RATE_LIMIT_PER_MINUTE` (model-route requests per
minute per client, default 12), `MAX_CONCURRENT_RUNS` (model runs in flight
at once, default 6), `USE_FIXTURES` (replay recorded model answers instead of
calling the API), and `MODEL_API_KEY` (the key itself, required unless
fixtures are on).

## Running it

```sh
npm run dev    # develop, with hot reload
npm run build  # the production build
npm run start  # serve the production build
```

Health, against a local build:

```sh
curl http://localhost:3000/api/health
```

```json
{
  "ok": true,
  "mode": "fixtures",
  "model": "muse-spark-1.3",
  "keyConfigured": false,
  "cohort": { "records": 484, "synthetic": true }
}
```

Explore, with the sample person (backend, L5, 7 years, Go and Kubernetes,
IN-south, aiming for L6 Staff Engineer):

```sh
curl -X POST http://localhost:3000/api/explore \
  -H 'content-type: application/json' \
  -d '{"profile":{"roleFamily":"backend","level":"L5","yearsExperience":7,"stack":["go","kubernetes"],"region":"IN-south"},"goal":{"targetLevel":"L6","label":"Staff Engineer"}}'
```

The answer is one JSON object (trimmed here; the real one also carries the
tornado, the smallest helpful changes and conflicts):

```json
{
  "goal": { "targetLevel": "L6", "label": "Staff Engineer" },
  "constraints": { "riskTolerance": "medium", "addSkills": [] },
  "twins": { "evidenceId": "ev_c3b70ed0", "n": 150 },
  "routes": [
    {
      "archetype": "climb",
      "n": 55,
      "reachedN": 47,
      "evidenceThin": false,
      "monthsToGoal": [34, 40],
      "reachedRate": [0.74, 0.92],
      "compBandRange": ["B4", "B5"]
    }
  ],
  "ranking": { "order": ["climb", "jump", "pivot"], "recommended": "climb" }
}
```

A streamed route, with `curl -N` (no buffering) so events print as they
arrive. This was run with `USE_FIXTURES=true`, and the fixture store has no
recording for the What-if interpreter, so the stream honestly ends in an
error event instead of a result; with `MODEL_API_KEY` set you would see
`stage` events, the second sheet, and a `result`:

```sh
curl -N -X POST http://localhost:3000/api/whatif \
  -H 'content-type: application/json' \
  -d '{"profile":{"roleFamily":"backend","level":"L5","yearsExperience":7,"stack":["go","kubernetes"],"region":"IN-south"},"goal":{"targetLevel":"L6","label":"Staff Engineer"},"message":"what if I go remote?","narrate":false}'
```

```
event: open
data: {"requestId":"aed8adee-7723-412b-afa8-e6fcaa94bf06"}

event: stage
data: {"type":"stage","stage":"interpreting"}

event: error
data: {"code":"not_configured","message":"The model is not configured on this server."}
```

All three outputs above were observed against a local production build
(`npm run build`, then `next start` with `USE_FIXTURES=true`); only the
explore body is trimmed, and the request id in the stream is the real one
from that run.

## Files

| File                           | What it is                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `src/lib/api/body.ts`          | Reads a JSON body with the size limit enforced from the header and while reading |
| `src/lib/api/client.ts`        | The browser caller: `postJson`, `streamPost`, one error type                     |
| `src/lib/api/errors.ts`        | `ApiError`, the stable codes, and `toApiError` mapping every failure to one      |
| `src/lib/api/handlers.ts`      | What each route does, as plain functions of (services, validated body)           |
| `src/lib/api/rateLimit.ts`     | The sliding-window limiter and the concurrency gate                              |
| `src/lib/api/route.ts`         | `defineRoute`: the one wrapper every route goes through                          |
| `src/lib/api/schemas.ts`       | The Zod schemas: what each route accepts                                         |
| `src/lib/api/serialize.ts`     | Shapes engine results for the browser, without internals                         |
| `src/lib/api/services.ts`      | Everything a route needs, built once and injectable for tests                    |
| `src/lib/api/sse.ts`           | The server event stream (heartbeat, one result or error, stops on disconnect)    |
| `src/lib/api/sseClient.ts`     | The client-side event parser, with no server imports                             |
| `src/app/layout.tsx`           | The root page shell and metadata                                                 |
| `src/app/page.tsx`             | The placeholder home page; the interface arrives in later parts                  |
| `src/app/globals.css`          | The global stylesheet (light/dark theme variables)                               |
| `src/app/api/health/route.ts`  | `GET /api/health`                                                                |
| `src/app/api/explore/route.ts` | `POST /api/explore`                                                              |
| `src/app/api/intake/route.ts`  | `POST /api/intake`                                                               |
| `src/app/api/plan/route.ts`    | `POST /api/plan`                                                                 |
| `src/app/api/privacy/route.ts` | `POST /api/privacy`                                                              |
| `src/app/api/whatif/route.ts`  | `POST /api/whatif`                                                               |

## Live evaluation

Measured on 3 Nov 2026 over real HTTP: `next start` with the real model key, each route called once with
`curl` for the sample engineer (backend, L5, 7 years, IN-south, goal Staff). This checks that the pieces work
together; the agents' own quality is measured in their parts.

| Route               | Result                                                                                                          | Time    |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------- |
| `GET /api/health`   | `mode: "live"`, `keyConfigured: true`, no key in the body                                                       | instant |
| `POST /api/privacy` | JSON; high risk for the email, the project and the employer found                                               | 2.6 s   |
| `POST /api/intake`  | stream of 3 events; `complete`, every field read with its quote                                                 | 8.8 s   |
| `POST /api/whatif`  | stream of 4 events; time limit 24 months applied, template or model narration, tornado attached                 | 10.5 s  |
| `POST /api/plan`    | stream of 17 events (open, stages, tool calls and results); `approved`, 3 routes, 5 evidence records, no repair | 25.7 s  |

One log line per request carried route, status, duration and an anonymous client label, and no request
content. Everything else in this part (guards, limits, streaming behaviour, error mapping) is pinned by tests
that need no network.

What review found along the way, all fixed with regression tests:

- **A hanging stream (found by my own test):** when the browser's abort signal fired, the stream was never
  closed, so a reader that was still reading waited forever. It now always closes.
- **A test helper that hid a gap:** the helper built its own logger with no secrets, so a test of key redaction
  could not pass. The services now accept a log sink, and the production logger with the key redacted is what
  gets tested.
- **A browser client that could not be bundled (Muse Code's bug hunt):** it reached Node-only modules through
  server barrel files. The client half of the SSE code moved to its own file, and a test builds the client for
  the browser to keep it that way.
- **Doubts that were real:** limits at the door were wider than the agents' own (a 600-character What-if message
  passed the schema and failed later), `addSkills` had no cap, a plain-Error `AbortError` was reported as a network
  failure, two model failures fell through to a generic 500, and a connected consumer that never read could make
  the server buffer without limit.

## Known limits

- The rate and concurrency counters are per server instance (in memory); a
  multi-instance deployment enforces them per instance, not globally.
- No authentication: the demo is public, protected only by the limits above.
- No CORS headers: same-origin only.
- SSE over serverless has platform time limits (hence `maxDuration`); a very
  slow plan run can be cut off by the platform, not by us.
- Once a stream has started, HTTP errors can no longer be reported: the
  streamed routes send failures as the `error` event instead.

## How to verify

```sh
npm run check   # typecheck, lint, format check, tests, secret scan
npm run build   # the production build, including its own typecheck
```

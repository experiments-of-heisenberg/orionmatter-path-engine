# Task: extra tests, a bug hunt and a docs page for Part 11, the API layer (tests and docs only)

Read AGENTS.md first and follow it. Part 11 added a Next.js app shell and a streaming API: src/lib/api/*.ts (errors, body,
rateLimit, sse, route, services, schemas, serialize, handlers, client) and the route files in src/app/api/*/route.ts. It is
implemented and reviewed. Your job is TESTS, a BUG HUNT and DOCUMENTATION. You must NOT change any file under src/, evals/,
scripts/ or next.config.ts.

## Read first (do not edit)
src/lib/api/*.ts, src/app/api/*/route.ts, next.config.ts, and the existing tests: tests/apiErrors.test.ts, apiBody.test.ts,
apiRateLimit.test.ts, apiSse.test.ts, apiRoutes.test.ts, apiClient.test.ts, tests/helpers/api.ts (installServices, post, readEvents,
person). Do NOT duplicate what they cover; add what is missing. Route handlers are plain (Request) => Response functions, so call them directly.

## Create these test files (Vitest, deterministic, offline, no live API, no real server)

1. tests/apiSchemasEdges.test.ts for src/lib/api/schemas.ts
   - every schema rejects an unknown top-level key (strict) and accepts the minimal valid body; defaults: constraints default for
     PlanRequest/ExploreRequest/WhatIfRequest.current.
   - boundaries: WhatIfRequest.message 2000 accepted and 2001 rejected; history max 3 (4 rejected), each question 400 and answer 600 characters;
     PrivacyRequest.text 3500/3501, companyType 40/41, k 1 and 1000 accepted, 0, 1001, 2.5 and "5" rejected, useModel must be boolean;
     IntakeRequest.text 7000 accepted? (read MAX_INTAKE_CHARS + 1000 and test the exact boundary), imageDataUrl at the cap and one over.
   - IntakeRequest.previous: a valid draft and provenance round-trips; a draft with an unknown key is rejected (the draft schema is strict);
     provenance source must be one of the four values; stack over 15 items, a milestone with verified true, level over 10 characters are rejected;
     provenance with more than... (state what happens for a record with many keys).
   - Profile and Goal come from src/lib/schemas.ts: state what happens to an unknown key INSIDE profile (Zod strips unknown keys by default unless strict):
     test it and report in your final message whether that is a concern (it is not an injection risk because stripped keys never reach the engine,
     but say what you see).
   - the type of Constraints values inside requests: maxMonths 1.5, 0, 241, "24" rejected; minCompBand "B6" rejected; addSkills over limits (see Constraints).
   - prototype-pollution style bodies: {"__proto__": {"x": 1}} and {"constructor": {...}} are rejected or ignored without polluting Object.prototype (assert Object.prototype is unchanged).

2. tests/apiRouteEdges.test.ts for route.ts and the route files (use installServices; read src/lib/api/route.ts first)
   - clientKey: x-forwarded-for with several hops uses the first and trims it; an empty header falls back to x-real-ip then "unknown"; two clients behind
     the same "unknown" key share a bucket (state it).
   - clientLabel is stable for the same input, differs for different inputs, is 8 hex characters.
   - errorResponse: status 499 is sent as 400; Retry-After present only when retryAfter is set; always has X-Request-Id and Cache-Control no-store.
   - a JSON-mode route whose run throws a ModelHttpError maps to 503 with Retry-After; a ZodError thrown inside run maps to 400.
   - a request whose body is valid but the gate is full: the response is 503 busy and the rate-limit counter was still consumed (state what happens).
   - 30 parallel requests to a light route with a limit of 10 per minute (RATE_LIMIT_PER_MINUTE 1 gives 10 for the light limiter): exactly 10 succeed and 20 are 429.
   - 8 parallel privacy requests with MAX_CONCURRENT_RUNS 2 and a model that waits on a gate promise: exactly 2 are served at once and 6 get 503 busy;
     after releasing the gate every slot is free again (gate.inFlight is 0).
   - the response of a streamed route always carries the SSE headers and an X-Request-Id equal to the id in the open event.
   - two different requests get different request ids.
   - a request with a body using a UTF-8 BOM, and one with invalid UTF-8 bytes: state what happens (read body.ts; JSON.parse fails on a BOM).
   - health: GET with no services installed uses getServices() and works with USE_FIXTURES (use installServices) and the response has no key.
   - methods: the route modules export only the expected methods (POST for the five routes, GET for health): assert Object.keys of each imported module
     includes the method and not the others, so a stray handler cannot appear.
   - the route module config exports: runtime "nodejs" and dynamic "force-dynamic" for all six; maxDuration present for plan (300), intake (120), whatif (120), privacy (60).

3. tests/apiSerializeEdges.test.ts for serialize.ts and handlers.ts
   - sheetToClient never includes a key named twinIds or stats; routes keep their order climb, jump, pivot; a sheet with skills asked keeps skills per route.
   - evidenceToClient lists every ledger record once, in call order, with a summary string and no twin ids; for an empty ledger it returns [].
   - planToClient: status, revisions, repaired and filledIn come from the run; the plan object is the same shape as RunPlanOutput.plan.
   - handleExplore for a person with no comparable engineers (goal EM2 for a backend person, or a role with no twins: find one from the data) does not throw and returns
     routes with n 0, a null recommended route and a conflict.
   - handleExplore does not mutate the request body (deep-compare before and after) and is deterministic (two calls equal except evidence ids; strip ids to compare).
   - handleWhatIf with an interpreter reply that changes nothing returns a template narration saying nothing meaningful changed and an unchanged diff.
   - exploreExtras defaults its second argument to body.constraints.

4. tests/apiNextConfig.test.ts
   - import the default export of next.config.ts; its headers() resolves to rules for source "/:path*" containing X-Content-Type-Options nosniff, X-Frame-Options DENY,
     Referrer-Policy no-referrer and a Permissions-Policy that disables camera, microphone and geolocation; poweredByHeader is false; reactStrictMode true;
     typescript.ignoreBuildErrors is false.

## Create docs/parts/part-11-api.md
Plain-language guide for someone new to the project. Include:
- The problem: the browser needs one safe door to every agent, with guards the agents should not have to think about, and live progress while a plan is built.
- A text diagram of the request pipeline: request, rate limit, size-limited read, Zod validation, concurrency gate, run, JSON or event stream; and where each error code can arise.
- An endpoint table: method and path, what it does, request body fields (read src/lib/api/schemas.ts), response (JSON or stream), model use (yes or no), limiter (model, plan, light), body limit.
- A table of stream events: open, stage (the stage names: reading, protecting, interpreting, explaining, gathering, composing, auditing, revising, done), tool_call, tool_result, note, verdict,
  result, error, plus the ": ping" heartbeat; and the rule that a stream ends with exactly one result or one error.
- An error table: every ApiErrorCode with its HTTP status, when it happens and what the browser should do (read errors.ts), and how a model failure becomes a code
  (read toApiError); state that unknown errors are generic to the browser and detailed only in the logs.
- The guards in detail: content type, size limits (64 KB, 6 MB for intake) enforced from the header AND while reading, strict schemas, the rate limiter (12 per minute by default;
  plan gets a third; deterministic routes ten times), the concurrency gate (6 by default), and the honest limit: counters are per server instance, and x-forwarded-for is trusted
  only because the hosting platform sets it.
- What the browser never receives: twin id lists, raw ledger, error detail text, keys. Say what it does receive (evidence ids and one-line summaries).
- Logging: one line per request (request id, route, status, milliseconds, an anonymous client label), no bodies, keys redacted.
- Disconnects: what happens when the browser closes a stream (the next event throws; the run stops; the slot is freed).
- The browser client (src/lib/api/client.ts): postJson, streamPost, ApiClientError and the client-only codes, with a short code example that compiles against the real signatures.
- Environment settings: RATE_LIMIT_PER_MINUTE, MAX_CONCURRENT_RUNS, USE_FIXTURES, MODEL_API_KEY (names only).
- Running it: npm run dev, npm run build, npm run start; curl examples for health and explore with a body that works (use the sample person: backend, L5, 7 years, stack go and kubernetes,
  region IN-south, goal L6 Staff Engineer) and for a streamed route using curl -N. Run the curl examples against a local build yourself if you can (USE_FIXTURES=true is enough for health and explore);
  otherwise do not invent output.
- A table of the files in src/lib/api/ and src/app/ with one line each.
- A section titled "Live evaluation" containing exactly this single sentence and nothing else:
  "Results of the live evaluation are added by the maintainer after measurement." (do not invent numbers).
- Known limits: in-memory limits are per instance; no authentication (the demo is public, protected only by the limits); no CORS headers (same-origin only); SSE over serverless has platform time limits;
  the streamed routes cannot report HTTP errors after the stream starts (they use the error event).
- How to verify: npm run check; npm run build.

## Rules
- BUG HUNT: if you find a bug in src/ or next.config.ts, do not fix it and do not write a failing test. Describe it in your final message (file, line, what is wrong, a concrete input,
  suggested fix). Look especially at: slot leaks in route.ts (every path that can enter the gate must release it, including a throw between entering and returning the stream), body.ts
  (chunk boundaries, multi-byte characters at the limit, BOM, a body that is read twice), rateLimit.ts (window edges, prune), sse.ts (heartbeat timers left running, double close, a work function that throws
  synchronously instead of rejecting, events after close), errors.ts (instanceof ordering: is any class a subclass of another so a more specific mapping is shadowed?), schemas.ts
  (limits that disagree with the agents' own limits, for example a schema max that is larger or smaller than the agent's cap), serialize.ts (anything that could leak internals), and client.ts
  (AbortError handling across runtimes: DOMException vs Error name).
- Run `npm run check` at the end. It must pass. Report the result honestly with the test count.
- Do not commit. Final message: files created, tests added, bugs and doubts.

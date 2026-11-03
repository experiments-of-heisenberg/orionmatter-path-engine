# Task: extra tests and a docs page for the model client (tests and docs only)

Read AGENTS.md first and follow it. The model client lives in src/lib/model/ and src/lib/log.ts.
It is already implemented and reviewed. Your job is TESTS and DOCUMENTATION only. You must NOT
change any file under src/.

## Existing tests you should read first (do not edit them)
tests/client.test.ts, tests/structured.test.ts, tests/toolLoop.test.ts, tests/log.test.ts,
tests/retry.test.ts, tests/json.test.ts and tests/helpers/fakeTransport.ts (reuse its helpers).

## Create these test files (Vitest, deterministic, offline, no live API calls)

1. tests/wire.test.ts for src/lib/model/wire.ts
   - toWireMessages: system/user string content; multimodal user content maps an image part to
     { type: "image_url", image_url: { url } }; an assistant message with toolCalls maps to
     tool_calls with type "function"; an assistant message with an empty toolCalls array has NO
     tool_calls key; a tool message maps toolCallId to tool_call_id.
   - buildRequestBody: includes tools and tool_choice only when tools are given; tool_choice is
     omitted when tools are given but toolChoice is not set; max_completion_tokens is the value passed in.
   - parseResponse: a minimal valid body; missing usage defaults all three token counts to 0;
     null content becomes ""; finish_reason missing becomes "unknown"; reasoning_content is used
     when reasoning is absent; throws ModelProtocolError for non-JSON and for an empty choices array.
   - describeErrorBody: extracts error.message from JSON, truncates to 200 characters, falls back
     to the raw text, and returns "(empty body)" for an empty string.

2. tests/mock.test.ts for src/lib/model/mock.ts
   - plays steps in order; records every request in `requests`; `remaining` counts down;
     rejects with a clear error when the script is exhausted; supports a function step that
     reads the request; callTools builds sequential ids call_1, call_2 and JSON-stringifies
     object args but passes string args through unchanged; defaults (usage zero, model "mock").

3. tests/toolDefs.test.ts for src/lib/model/toolDefs.ts
   - the result has the given name and description; parameters.type is "object" and lists the
     schema's properties and required fields; there is no "$schema" key in parameters; and a
     real example: toolDefinition("findTwins", "...", ToolArgSchemas.findTwins) from
     src/lib/tools produces parameters whose properties include profile and goal.

4. tests/fixtures.test.ts for src/lib/model/fixtures.ts (use os.tmpdir() + fs.mkdtemp; clean up)
   - stableStringify sorts object keys, ignores undefined values, and is stable for nested data.
   - FileFixtureStore: put then get round-trips; get returns undefined for a missing file; the file
     is named with the first 16 chars of the key; a corrupt or wrong-shape JSON file makes get
     reject (do not swallow it); a file whose stored key differs from the requested key (same
     16-char prefix) returns undefined.
   - MemoryFixtureStore basic put/get.

5. tests/transport.test.ts for fetchTransport in src/lib/model/transport.ts
   - Start a real local HTTP server with node:http on 127.0.0.1 port 0 inside the test and close
     it afterwards. Cover: returns status, body text and the retry-after header; a non-2xx status is
     returned (not thrown); a server that never answers with timeoutMs = 50 throws ModelTimeoutError;
     an already-aborted AbortSignal throws ModelAbortedError; a closed port throws ModelNetworkError.

## Create docs/parts/part-3-model-client.md
Plain-language description for a reader new to the project: what problem the client solves, a
diagram-style list of the layers (transport, retry, wire, client, structured, tool loop, fixtures,
mock), a table of the files in src/lib/model/ with one line each, a table of the typed errors and
when each is thrown (read src/lib/model/errors.ts), how fixtures record and replay (env flags
USE_FIXTURES and RECORD_FIXTURES), how to use the client from an agent with a short TypeScript
example using createModelClient, chatStructured and runToolLoop, and the design decisions: why
the token budget escalates (Muse Spark counts hidden reasoning inside max_completion_tokens,
see docs/api-notes.md), why temperature is left unset, why every side effect is injected.
Keep it accurate to the code: read the source rather than guessing.

## Rules
- If you find a BUG in src/, do not fix it and do not write a failing test. Describe it in your
  final message (file, line, what is wrong, suggested fix).
- Run `npm run check` at the end. It must pass. Report the result honestly, including test count.
- Do not commit. Final message: list files created and any bugs or doubts.

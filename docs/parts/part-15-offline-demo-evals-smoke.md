# Part 15: the offline demo, live evaluations and the smoke test

Part 15 is the part that lets a stranger run the app. Before it, every
interesting screen needed a Meta Model API key. Now there is a demo build that
replays recorded Muse Spark answers, a script that checks a deployed server
end to end, and a set of live evaluations with their raw outputs kept in the
repository. This page explains how those pieces work and how to redo them.

## Why a demo that needs no key

A hackathon judge, a reviewer, or a curious user should be able to open the app
and click through every tab without signing up for an API key or paying for
model calls. The offline demo does that by replaying answers that were recorded
earlier against the live API. Every one-click example (the sample story, the
four What if sentences, the plans for the resulting limits, the sample privacy
text) works; anything else is refused with a message that says so. The screen
always says it is a replay, so nobody mistakes it for a live model.

## How recording and replay work

Recording runs the one-click examples against the real API once and saves each
answer as a JSON file in `src/fixtures/`. Each file carries a `label` (which
call it answers, for example `planner:compose`) and a `key`, a stable hash of
the request. Replay reverses the process: with `USE_FIXTURES=true`, the model
client hashes each outgoing request and returns the recording with that key
instead of calling the API.

Two details make replay line up:

- **Content-hashed evidence ids.** Evidence ids used to be random per run, so
  a recorded answer citing `ev_3fa1...` would never match the fresh random ids
  of a replayed session, and the Skeptic would reject every revived plan. Now
  an id is `ev_` plus 8 hex characters of a hash of the tool and its arguments
  (`contentId` in `src/lib/tools/ledger.ts`; a repeated identical call gets
  `_2`). The same question always gets the same id, so a recorded run replays
  exactly, while the model still cannot guess the id of a lookup it never made.
- **The gather prompt states the limits.** The limits are applied to every
  lookup by code, and they are also written into the gather prompt, so two
  people with different limits never share one request — which matters because
  the request hash is what selects the recording (`plannerPrompts.ts`).

## What is recorded, and what happens for anything else

Recorded: the example story intake, the four What if sentences, the plan for
each resulting set of limits, and the example privacy text — 38 fixture files
in `src/fixtures/`. Anything else (your own story, your own sentence) is not in
the recordings, and the server refuses it with a `demo_only` error (HTTP 422):

"This demo replays recorded Muse Spark answers, and that one was not recorded.
Use one of the example buttons, or run the app with your own key."

The message never echoes your input. On the client this error is not retryable:
trying again cannot help, because there is nothing to retry against.

## The replay banner

When the server runs with fixtures, the app says so on screen: a chip reading
"Demo build: replaying recorded Muse Spark answers". The app asks the server
once for its mode (`useServerMode` in `src/components/PathApp.tsx`) and shows
the chip only when the answer is fixtures. If the question fails, the screen
simply does not say anything rather than guessing.

## How fixtures ship in a deploy

The recordings are read from disk at request time, not imported by any module,
so Next's file tracer would not know to include them in a production deploy.
`next.config.ts` says so explicitly:

`outputFileTracingIncludes: { "/api/**/*": ["./src/fixtures/**/*"] }`

That keeps the 38 recordings next to the API routes that read them, so a
deployed demo build replays without a key too.

## The smoke script

`scripts/smoke-e2e.ts` (run as `npm run smoke`) checks a running server the way
a judge would load it. Five checks always run, all without a model:

1. **health**: the server is up, says which mode it is in, and labels its
   cohort synthetic — with nothing key-shaped in the answer.
2. **page**: the home page loads, mentions Orionmatter, and never mentions
   `MODEL_API_KEY`.
3. **explore**: three routes for the sample engineer, with no cohort record ids
   leaking into the answer.
4. **privacy**: the disclosure ladder has at least three steps and never grows.
5. **validation**: a malformed request gets a 400 with a stable error code and
   no stack trace.

Two flags add model-backed checks: `--model` also runs one What if example
(applied and explained), and `--plan` also runs a full plan with the Skeptic's
verdict streamed (`--plan` implies `--model`; live, a plan takes about half a
minute). The script exits 0 when every check passes and 1 otherwise. Against a
deploy, pass its URL:

`npm run smoke -- https://your-app.vercel.app --plan`

With no URL it checks `http://localhost:3000`.

## The live suites

The live evaluations run the real agents against Muse Spark and ask what only a
live run can answer: does the model follow the rules, and does the checking
around it catch it when it does not? There is one suite per concern — the model
client (budget escalation, structured JSON, a tool loop, record-then-replay),
intake (complete, restrained, partial, injection-proof, follow-ups), the Privacy
Guard's text check (finds details, leaves generic text alone, resists
injections), the What if interpreter (clear, relative, unsupported, vague,
contradictory, small talk, multi-turn, safety), full What if turns with the
narrator's grounding checks, the Planner alone with a consistency audit, and the
Planner with the Skeptic on six scenarios. The raw outputs are kept in
`docs/evidence/live/` (`client.txt`, `intake.txt`, `privacy.txt`, `whatif.txt`,
`whatif-run.txt`, `planner.txt`, `audit.txt`), and `docs/evals.md` explains what
was measured and how to reproduce each suite with a key.

What the numbers do not show, from `docs/evals.md`:

- **Small suites.** 2 to 28 cases each, written by us, one run each. There are
  no confidence intervals and no repeated trials, so a full pass means "no
  failures in these cases", not "never fails".
- **The cohort is synthetic** (484 generated engineers, seed 1026). The routes'
  ranges show how the method behaves on this dataset. They are not evidence
  about real careers and the app says so on every screen.
- **The Skeptic checks consistency, not truth.** It proves that each number in
  a plan matches the evidence the plan cites. It cannot tell whether advice is
  wise, and an approved plan is still not a promise.
- **Latency is what the API gave that morning**, from one location. Treat it as
  an order of magnitude.
- **The Privacy Guard is not a guarantee.** It finds details in text and counts
  how large a crowd the profile hides in. It does not know the real world, and
  pay in unusual phrasing can slip past the code detectors.
- **Muse Spark was the only model tried for the product.** There is no
  comparison with another model, so nothing here says Muse Spark is better than
  anything else, only that the system built around it holds up on these checks.

## How to redo the recordings

`RECORD_FIXTURES=true npm run record:demo`

You must redo the recordings when the example texts in `src/ui/demo.ts` change
(a test fails until you do), when a prompt that serves an example changes, when
the model version changes, or whenever the fixtures drift from what the live
API now returns.

## How to verify

`npm run check` (types, lint, format, tests, secret scan) must pass. Then:

`npm run build`

`USE_FIXTURES=true npm start` and, against it,
`npm run smoke -- http://localhost:3000 --plan`

## Live evaluation

Results of the live evaluation are added by the maintainer after measurement.

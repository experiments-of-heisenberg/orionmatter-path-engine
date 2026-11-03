# API notes: what we verified against the live Muse APIs

_Part 0 findings, 3 Nov 2026. Everything below was observed with live calls from
`scripts/smoke-models.ts` and `scripts/probe-vision.ts`, not assumed from docs._

## Endpoints and models

|                 | Muse Spark (Meta Model API)                  | Muse Spark Open (Baseten)                         |
| --------------- | -------------------------------------------- | ------------------------------------------------- |
| Base URL        | `https://api.meta.ai/v1`                     | `https://inference.baseten.co/v1`                 |
| Auth            | `Authorization: Bearer $MODEL_API_KEY`       | `Authorization: Bearer $BASETEN_API_KEY`          |
| Model id we use | `muse-spark-1.3`                             | `meta-models/muse-spark-open-1026` (hackathon id) |
| Endpoint        | `POST /chat/completions` (OpenAI-compatible) | same                                              |

Other models on the Meta API (from `GET /v1/models`): `muse-spark-1.2`, `muse-spark-1.1`,
`muse-wonder-1.0`, `muse-image-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1`, plus
`-contributor` variants. Baseten lists both `meta-models/muse-spark-open` and
`meta-models/muse-spark-open-1026`; the hackathon requires the `-1026` one.

## Capability matrix (all probes passed after fixing our own probe bugs)

| Capability                        | Spark    | Open                    | Note                                                                        |
| --------------------------------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| Plain reply                       | yes      | yes                     |                                                                             |
| `system` role                     | yes      | yes                     |                                                                             |
| `developer` role                  | yes      | yes                     | Meta docs prefer `developer`                                                |
| Native tool calling               | yes      | yes                     | returns `tool_calls`, `finish_reason: "tool_calls"`                         |
| JSON via prompt                   | yes      | yes                     | clean JSON, no fences in our probe                                          |
| `response_format: json_object`    | yes      | yes                     | Baseten docs say Open lacks JSON mode, yet it worked. Treat as best effort. |
| `reasoning_effort` low / minimal  | yes      | yes                     | `none` is rejected by Spark per docs                                        |
| `temperature: 0.2`                | accepted | accepted                | Meta recommends leaving the default (1.0) for Spark                         |
| Image input                       | yes      | yes                     | see vision findings                                                         |
| Reasoning text exposed in message | no       | yes (`reasoning` field) |                                                                             |

## Findings that change the code

1. **Token budget includes hidden reasoning.** On Spark, `max_completion_tokens: 200`
   returned an EMPTY reply because 198 of the 200 tokens were reasoning. Use a
   generous budget (we use 3000+; the Planner will need more) and treat an empty
   `content` with `finish_reason: "length"` as a retryable error, not as a result.
2. **Reasoning effort is the cost and latency dial.** `minimal` used ~12 reasoning
   tokens versus 200 to 1000 at the default. Use `minimal` or `low` for simple
   structured steps (What-if constraint parsing, Intake) and higher for the Planner
   and Skeptic critic.
3. **Always validate JSON ourselves.** Even where JSON mode works, keep Zod validation
   plus one repair retry. The model client must not depend on `response_format`.
4. **Vision works for real documents.** Both models transcribed a rendered resume
   snippet exactly. A tiny 8x8 solid-red image was misread as "white" by both, but
   64x64 and larger were read correctly. Irrelevant for resume screenshots; do not
   use tiny images in tests.
5. **Latency (single calls).** Spark: 0.6 to 4 s for short replies, about 9.6 s for an
   image call. Open: 0.5 to 2 s, about 2.9 s for an image call. Design the streaming
   UI so the first agent event appears within a second or two.

## Reasoning effort and latency (measured in Part 4)

Muse Spark's hidden reasoning dominates latency. For the Planner's composition call (write
structured JSON around computed facts), measured on 3 Nov 2026:

| Reasoning effort | Compose call                                                                                           | Whole planner run | Validated first time?                     |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------- |
| medium           | 157 s (6,782 tokens, 5,415 of them reasoning; the 8,000-token budget was exhausted once and escalated) | 174 s             | yes, after escalation                     |
| low              | 47 s (4,481 tokens, 3,526 reasoning)                                                                   | 70 s              | no: reply had no parseable JSON, repaired |
| minimal          | 13 s (1,753 tokens, 956 reasoning)                                                                     | 32 s              | yes                                       |

Across four further live runs at `minimal`, whole runs took 19 to 42 s, every plan's claims were
consistent with the evidence ledger, and one of four needed a repair. Lesson: for tasks that
mostly write text around supplied facts, more reasoning is slower and no more reliable. Reserve
higher effort for tasks that genuinely need judgement.

## Muse Code

- Installed version: **1.4.14**, binary at `~/.local/bin/muse`.
- Authenticates headlessly with `META_API_KEY` (we alias it from `MODEL_API_KEY`).
- `muse exec` works non-interactively; verified it writes files and runs commands.
- The OS sandbox helper `bwrap` is **unavailable** in our container, so shell commands
  fail unless the sandbox is disabled. We pass `--disable-sandbox --disable-approval
--trust-workspace` only because the container is disposable, and withhold every key
  except `META_API_KEY` from the process.
- `muse export --last --redacted --out <file>` produces a self-contained JSON session
  log. We scanned raw and redacted exports and the JSONL
  stream for both key values: no leaks.
- `scripts/muse-run.sh` wraps all of this: fixed safe flags, prompt saved as evidence,
  redacted export, automatic leak scan that deletes evidence on a match.
- **Contributor mode (data sharing).** Muse Code can run on `muse-spark-1.3-contributor`,
  which lets Meta use the run's prompts, code and responses to train future models, in
  exchange for cheaper tokens. On our account a headless run used the contributor model by
  default, and `--contributor-mode off` alone did NOT change that. Pinning
  `--model muse-spark-1.3` does (verified in the session log). `scripts/muse-run.sh` pins it.
  Standard pricing is $1.25 / $4.25 per 1M input / output tokens versus $0.10 / $0.20
  in Contributor mode, so Standard runs spend our API credit faster.
- Session exports are about 3 MB raw for one task, so the runner gzips them (about 0.4 MB).
- Exit code 0 means the turn completed, not that the work is correct. Always run the
  project's own tests afterwards.

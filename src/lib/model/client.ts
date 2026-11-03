/**
 * client.ts: the model client every agent uses.
 *
 * One function, `chat`, hides everything that is annoying about calling a hosted model:
 *   - sending every request to the Meta Model API (Muse Spark), the only provider
 *   - timeouts and retries with backoff on transient failures (429, 5xx, network)
 *   - Muse Spark's habit of spending the whole token budget on hidden reasoning and
 *     returning nothing: the client detects this and retries with a bigger budget
 *   - token and latency logging, with secrets and message content kept out of logs
 *   - fixture record and replay, so demos and tests never need the network
 *
 * Everything with side effects (HTTP, sleeping, randomness, clock, logging) is injected,
 * so the whole retry and escalation logic is unit-tested offline.
 */
import type { Env } from "../env";
import { noopLogger, type Logger } from "../log";
import {
  FileFixtureStore,
  fixtureKey,
  type FixtureMode,
  type FixtureResult,
  type FixtureStore,
} from "./fixtures";
import {
  FixtureMissError,
  ModelConfigError,
  ModelEmptyResponseError,
  ModelError,
  ModelHttpError,
} from "./errors";
import { backoffDelay, DEFAULT_RETRY_POLICY, parseRetryAfter, type RetryPolicy } from "./retry";
import { fetchTransport, type HttpTransport } from "./transport";
import type { ChatRequest, ChatResult, ModelClient, ModelTarget } from "./types";
import { buildRequestBody, describeErrorBody, parseResponse } from "./wire";

/** Side-effecting dependencies, all optional so production code can use the defaults. */
export interface ModelClientDeps {
  transport?: HttpTransport;
  /** Sleep for a number of milliseconds. Tests pass a no-op or a recorder. */
  sleep?: (ms: number) => Promise<void>;
  /** Random number in [0, 1) used for backoff jitter. */
  random?: () => number;
  logger?: Logger;
  /** Milliseconds clock, used to measure latency. */
  now?: () => number;
  fixtures?: FixtureStore;
  /** Overrides the mode derived from the environment. */
  fixtureMode?: FixtureMode;
}

/** Tunable defaults. All have sensible values. */
export interface ModelClientOptions {
  retry?: Partial<RetryPolicy>;
  /** Per-attempt timeout when a request does not set one. Reasoning calls can be slow, so this is generous. */
  defaultTimeoutMs?: number;
  /** Token budget when a request does not set one. */
  defaultMaxCompletionTokens?: number;
  /** Largest budget the escalation logic will ask for. */
  maxCompletionTokensCap?: number;
  /** How many times to enlarge the budget after an empty, truncated reply. */
  maxEscalations?: number;
  /** Where recorded fixtures live. */
  fixtureDirectory?: string;
}

const DEFAULTS = {
  defaultTimeoutMs: 90_000,
  defaultMaxCompletionTokens: 4_000,
  maxCompletionTokensCap: 16_000,
  maxEscalations: 2,
  fixtureDirectory: "src/fixtures",
} as const;

/** Connection details for one target, resolved from validated config. */
interface TargetConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

function resolveTarget(env: Env, _target: ModelTarget): TargetConfig {
  // One provider: the Meta Model API. `target` stays an explicit field on every request so that
  // recorded fixtures keep their keys and a future provider would be a visible, reviewed change.
  return { baseUrl: env.META_API_BASE_URL, apiKey: env.MODEL_API_KEY, model: env.META_MODEL_SPARK };
}

function modeFromEnv(env: Env): FixtureMode {
  if (env.USE_FIXTURES) return "replay";
  if (env.RECORD_FIXTURES) return "record";
  return "off";
}

/**
 * Create the production model client.
 *
 * @param env     validated configuration (see env.ts)
 * @param deps    optional overrides for side effects; tests inject fakes here
 * @param options optional tuning of timeouts, retries and token budgets
 */
export function createModelClient(
  env: Env,
  deps: ModelClientDeps = {},
  options: ModelClientOptions = {},
): ModelClient {
  const transport = deps.transport ?? fetchTransport;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? noopLogger;
  const mode = deps.fixtureMode ?? modeFromEnv(env);
  const settings = { ...DEFAULTS, ...options };
  const retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  const store: FixtureStore | undefined =
    mode === "off" ? undefined : (deps.fixtures ?? new FileFixtureStore(settings.fixtureDirectory));

  /** One HTTP exchange with retries for transient failures. Returns the parsed reply and attempts used. */
  async function callWithRetries(
    request: ChatRequest,
    config: TargetConfig,
    maxCompletionTokens: number,
  ): Promise<{ parsed: ReturnType<typeof parseResponse>; attempts: number }> {
    if (!config.apiKey) {
      throw new ModelConfigError(
        `no API key configured for target "${request.target}" (set it, or use USE_FIXTURES=true)`,
      );
    }
    const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body = buildRequestBody(request, config.model, maxCompletionTokens);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
    const timeoutMs = request.timeoutMs ?? settings.defaultTimeoutMs;

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await transport.post({ url, headers, body, timeoutMs, signal: request.signal });
        if (response.status < 200 || response.status >= 300) {
          throw new ModelHttpError(
            response.status,
            describeErrorBody(response.text),
            parseRetryAfter(response.retryAfter, now()),
          );
        }
        return { parsed: parseResponse(response.text), attempts: attempt + 1 };
      } catch (error) {
        const retryable = error instanceof ModelError && error.retryable;
        if (!retryable || attempt >= retryPolicy.maxRetries) throw error;
        const retryAfterMs = error instanceof ModelHttpError ? error.retryAfterMs : undefined;
        const delay = backoffDelay(attempt, retryPolicy, random, retryAfterMs);
        logger.warn("model.retry", {
          label: request.label,
          target: request.target,
          attempt: attempt + 1,
          delayMs: delay,
          reason: error.message,
        });
        await sleep(delay);
      }
    }
  }

  /** A live call, including the escalation for replies emptied by reasoning. */
  async function live(request: ChatRequest): Promise<FixtureResult & { attempts: number }> {
    const config = resolveTarget(env, request.target);
    let budget = request.maxCompletionTokens ?? settings.defaultMaxCompletionTokens;
    let attempts = 0;

    for (let escalation = 0; ; escalation++) {
      const { parsed, attempts: used } = await callWithRetries(request, config, budget);
      attempts += used;

      const empty = parsed.text.trim() === "" && parsed.toolCalls.length === 0;
      if (!empty) {
        return {
          text: parsed.text,
          toolCalls: parsed.toolCalls,
          finishReason: parsed.finishReason,
          usage: parsed.usage,
          model: parsed.model ?? config.model,
          ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
          attempts,
        };
      }

      // Empty reply. If the provider says it ran out of tokens, a bigger budget can help.
      const canEscalate =
        parsed.finishReason === "length" &&
        escalation < settings.maxEscalations &&
        budget < settings.maxCompletionTokensCap;
      if (!canEscalate) throw new ModelEmptyResponseError(parsed.finishReason, budget);
      const next = Math.min(budget * 2, settings.maxCompletionTokensCap);
      logger.warn("model.escalate_budget", { label: request.label, from: budget, to: next });
      budget = next;
    }
  }

  return {
    async chat(request: ChatRequest): Promise<ChatResult> {
      const config = resolveTarget(env, request.target);
      const key = fixtureKey(request, config.model);
      const started = now();

      if (mode === "replay") {
        const recorded = await store?.get(key);
        if (!recorded) throw new FixtureMissError(request.label, key);
        logger.info("model.replay", { label: request.label, target: request.target });
        return { ...recorded, attempts: 0, latencyMs: 0, fromFixture: true };
      }

      const { attempts, ...result } = await live(request);
      const latencyMs = now() - started;

      if (mode === "record") await store?.put(key, request.label, result);

      // Log accounting only: never message content, which can contain user career data.
      logger.info("model.call", {
        label: request.label,
        target: request.target,
        model: result.model,
        latencyMs,
        attempts,
        finishReason: result.finishReason,
        ...result.usage,
      });
      return { ...result, attempts, latencyMs, fromFixture: false };
    },
  };
}

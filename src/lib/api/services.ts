/**
 * services.ts: everything a route needs, built once and injectable.
 *
 * Routes never construct a model client or read the environment themselves. They ask for the
 * services, which production builds from the validated environment and tests replace with fakes
 * (a scripted model, a fixed clock, tiny limits). That is what keeps the routes testable without a
 * network, a key or a running server.
 */
import { getEnv, type Env } from "../env";
import { createLogger, type Logger } from "../log";
import { createModelClient, type ModelClient } from "../model";
import { ConcurrencyGate, RateLimiter } from "./rateLimit";

export interface Services {
  env: Env;
  logger: Logger;
  client: ModelClient;
  /** Routes that call the model. */
  modelLimiter: RateLimiter;
  /** The full plan run: several model calls, so a third of the model allowance. */
  planLimiter: RateLimiter;
  /** Deterministic routes (no model): sliders call these often. */
  lightLimiter: RateLimiter;
  /** Model runs in flight at once. */
  gate: ConcurrencyGate;
  now: () => number;
}

export interface ServiceOverrides {
  env?: Env;
  client?: ModelClient;
  logger?: Logger;
  /** Where log lines go (default stderr). Used when no `logger` is given, so the production logger, with the key redacted, is what gets tested. */
  logSink?: (line: string) => void;
  now?: () => number;
}

const MINUTE = 60_000;

/** Build the services. Tests pass overrides; production passes none. */
export function createServices(overrides: ServiceOverrides = {}): Services {
  const env = overrides.env ?? getEnv();
  const secrets = [env.MODEL_API_KEY].filter((key): key is string => Boolean(key));
  const logger =
    overrides.logger ??
    createLogger({
      level: env.LOG_LEVEL,
      secrets,
      ...(overrides.logSink ? { sink: overrides.logSink } : {}),
    });
  const now = overrides.now ?? Date.now;
  return {
    env,
    logger,
    client: overrides.client ?? createModelClient(env, { logger }),
    modelLimiter: new RateLimiter(env.RATE_LIMIT_PER_MINUTE, MINUTE, now),
    planLimiter: new RateLimiter(Math.max(1, Math.ceil(env.RATE_LIMIT_PER_MINUTE / 3)), MINUTE, now),
    lightLimiter: new RateLimiter(env.RATE_LIMIT_PER_MINUTE * 10, MINUTE, now),
    gate: new ConcurrencyGate(env.MAX_CONCURRENT_RUNS),
    now,
  };
}

let current: Services | undefined;

/** The process-wide services, built on first use. */
export function getServices(): Services {
  current ??= createServices();
  return current;
}

/** Replace the process-wide services. Intended for tests. */
export function setServices(services: Services | undefined): void {
  current = services;
}

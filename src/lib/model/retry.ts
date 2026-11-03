/**
 * retry.ts: backoff policy for transient model API failures.
 *
 * Exponential backoff with jitter avoids hammering a struggling API and avoids many
 * clients retrying in lockstep. A server-supplied Retry-After always wins over our
 * own schedule, because the server knows when it will be ready.
 */

export interface RetryPolicy {
  /** Retries after the first attempt, so total attempts = maxRetries + 1. */
  maxRetries: number;
  /** Delay before the first retry, before jitter. */
  baseDelayMs: number;
  /** Upper bound on any single delay, including Retry-After. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

/**
 * Parse a Retry-After header, which is either whole seconds or an HTTP date.
 *
 * @returns milliseconds to wait, or undefined when the header is absent or unusable.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Delay before retry number `retryIndex` (0 for the first retry).
 *
 * @param retryIndex    zero-based retry counter
 * @param policy        backoff settings
 * @param random        source of randomness in [0, 1); injectable for tests
 * @param retryAfterMs  server-requested delay, which overrides the computed one
 * @returns milliseconds to sleep, never above policy.maxDelayMs
 */
export function backoffDelay(
  retryIndex: number,
  policy: RetryPolicy,
  random: () => number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, policy.maxDelayMs);
  const exponential = policy.baseDelayMs * 2 ** retryIndex;
  // +/- 20% jitter around the exponential value.
  const jittered = exponential * (0.8 + random() * 0.4);
  return Math.min(Math.round(jittered), policy.maxDelayMs);
}

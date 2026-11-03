/**
 * rateLimit.ts: protect the paid model key from abuse and runaway clients.
 *
 * Two small guards, both in memory:
 *   - a sliding-window limiter per client key (requests per window)
 *   - a concurrency gate (model runs in flight at once)
 *
 * Honest scope: memory is per server instance. A serverless deployment runs several instances, each
 * with its own counters, so this is a best-effort guard that stops loops and casual abuse; it is
 * not a global quota. A real quota belongs in a shared store.
 */

export interface LimitDecision {
  allowed: boolean;
  /** Seconds until a request would be allowed, when not allowed. */
  retryAfter: number;
}

/** A sliding-window rate limiter keyed by client. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count one request for `key` and say whether it is allowed. */
  check(key: string): LimitDecision {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => t - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? t;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    this.prune(t);
    return { allowed: true, retryAfter: 0 };
  }

  /** Forget keys with no recent hits so the map cannot grow without bound. */
  private prune(t: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, times] of this.hits) {
      if (times.every((time) => t - time >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** A gate that allows at most `max` runs at once. */
export class ConcurrencyGate {
  private active = 0;

  constructor(private readonly max: number) {}

  /** Try to start a run. Returns a release function, or undefined when the gate is full. */
  tryEnter(): (() => void) | undefined {
    if (this.active >= this.max) return undefined;
    this.active++;
    let released = false;
    return () => {
      if (released) return; // releasing twice must not free someone else's slot
      released = true;
      this.active--;
    };
  }

  get inFlight(): number {
    return this.active;
  }
}

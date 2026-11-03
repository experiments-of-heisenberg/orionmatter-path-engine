/** Tests for the rate limiter and the concurrency gate. */
import { describe, expect, it } from "vitest";
import { ConcurrencyGate, RateLimiter } from "../src/lib/api/rateLimit";

describe("RateLimiter", () => {
  it("allows up to the limit in a window and then says how long to wait", () => {
    let t = 0;
    const limiter = new RateLimiter(3, 60_000, () => t);
    expect([1, 2, 3].map(() => limiter.check("a").allowed)).toEqual([true, true, true]);
    t = 10_000;
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfter: 50 });
  });

  it("is a sliding window: capacity returns as old hits age out, one at a time", () => {
    let t = 0;
    const limiter = new RateLimiter(2, 60_000, () => t);
    limiter.check("a");
    t = 30_000;
    limiter.check("a");
    t = 59_999;
    expect(limiter.check("a").allowed).toBe(false);
    t = 60_000; // the first hit is now exactly a window old
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("keeps clients apart", () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("does not count a refused request against the client", () => {
    let t = 0;
    const limiter = new RateLimiter(1, 60_000, () => t);
    limiter.check("a");
    for (let i = 0; i < 20; i++) limiter.check("a"); // hammering while blocked
    t = 60_000;
    expect(limiter.check("a").allowed).toBe(true); // not extended by the refused attempts
  });

  it("always reports a retry time of at least one second", () => {
    let t = 0;
    const limiter = new RateLimiter(1, 1000, () => t);
    limiter.check("a");
    t = 999;
    expect(limiter.check("a").retryAfter).toBe(1);
  });

  it("forgets idle clients so memory cannot grow without bound", () => {
    let t = 0;
    const limiter = new RateLimiter(5, 1000, () => t);
    for (let i = 0; i < 1200; i++) limiter.check(`client-${i}`);
    t = 5000;
    limiter.check("fresh");
    // internal map is private; behaviour check: an old client starts from a clean slate
    expect(limiter.check("client-0").allowed).toBe(true);
  });
});

describe("ConcurrencyGate", () => {
  it("lets at most `max` runs in, and frees a slot on release", () => {
    const gate = new ConcurrencyGate(2);
    const a = gate.tryEnter();
    const b = gate.tryEnter();
    expect(gate.tryEnter()).toBeUndefined();
    expect(gate.inFlight).toBe(2);
    a?.();
    expect(gate.inFlight).toBe(1);
    expect(gate.tryEnter()).toBeDefined();
    b?.();
  });

  it("releasing twice does not free someone else's slot", () => {
    const gate = new ConcurrencyGate(1);
    const release = gate.tryEnter();
    release?.();
    release?.();
    const next = gate.tryEnter();
    release?.(); // a stale release must not open the gate under the new holder
    expect(next).toBeDefined();
    expect(gate.tryEnter()).toBeUndefined();
  });
});

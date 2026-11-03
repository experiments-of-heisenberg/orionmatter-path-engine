/** Tests for the retry policy: backoff growth, caps, jitter bounds and Retry-After parsing. */
import { describe, expect, it } from "vitest";
import { backoffDelay, DEFAULT_RETRY_POLICY, parseRetryAfter } from "../src/lib/model/retry";

const policy = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 };
const middle = () => 0.5; // jitter factor of exactly 1.0

describe("backoffDelay", () => {
  it("doubles each retry (with neutral jitter)", () => {
    expect([0, 1, 2].map((i) => backoffDelay(i, policy, middle))).toEqual([100, 200, 400]);
  });

  it("never exceeds the maximum delay", () => {
    expect(backoffDelay(10, policy, middle)).toBe(1000);
  });

  it("keeps jitter within +/- 20%", () => {
    expect(backoffDelay(0, policy, () => 0)).toBe(80);
    expect(backoffDelay(0, policy, () => 0.999)).toBe(120);
  });

  it("lets a server-supplied Retry-After override the schedule, still capped", () => {
    expect(backoffDelay(0, policy, middle, 750)).toBe(750);
    expect(backoffDelay(0, policy, middle, 60_000)).toBe(1000);
  });

  it("has sane defaults: 2 retries, 500 ms base", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({ maxRetries: 2, baseDelayMs: 500, maxDelayMs: 8000 });
  });
});

describe("parseRetryAfter", () => {
  it("reads whole seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    expect(parseRetryAfter("Tue, 03 Nov 2026 00:00:05 GMT", now)).toBe(5000);
  });

  it("never returns a negative wait for a date in the past", () => {
    const now = Date.parse("2026-11-03T00:00:10Z");
    expect(parseRetryAfter("Tue, 03 Nov 2026 00:00:00 GMT", now)).toBe(0);
  });

  it("returns undefined for missing or unusable headers", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

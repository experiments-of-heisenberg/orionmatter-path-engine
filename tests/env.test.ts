/** Tests for environment validation: defaults, required keys, fixture mode, no secret leakage. */
import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "../src/lib/env";

// Deliberately fake values, used to prove error messages never echo secrets.
const fakeMetaKey = "LLM_123_supersecretvalue"; // scan-secrets:allow fake test value
const keys = { MODEL_API_KEY: fakeMetaKey };

describe("parseEnv", () => {
  it("applies defaults for everything except the keys", () => {
    const env = parseEnv(keys);
    expect(env.META_API_BASE_URL).toBe("https://api.meta.ai/v1");
    expect(env.META_MODEL_SPARK).toBe("muse-spark-1.3");
    expect(env.USE_FIXTURES).toBe(false);
    expect(env.COHORT_SEED).toBe(1026);
  });

  it("requires the key in live mode and names it", () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    try {
      parseEnv({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("MODEL_API_KEY is required unless USE_FIXTURES=true");
    }
  });

  it("needs no keys in fixture mode", () => {
    expect(parseEnv({ USE_FIXTURES: "true" }).USE_FIXTURES).toBe(true);
  });

  it("rejects an invalid base URL", () => {
    expect(() => parseEnv({ ...keys, META_API_BASE_URL: "not a url" })).toThrow(EnvError);
  });

  it("rejects a non-boolean USE_FIXTURES instead of silently treating it as false", () => {
    expect(() => parseEnv({ ...keys, USE_FIXTURES: "yes" })).toThrow(EnvError);
  });

  it("never includes secret values in error messages", () => {
    try {
      parseEnv({ ...keys, META_API_BASE_URL: "bad" });
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(fakeMetaKey);
    }
  });

  it("has no setting for any other model provider: the Meta Model API is the only one", () => {
    const env = parseEnv({ ...keys, BASETEN_API_KEY: "ignored", OPEN_MODEL_ID: "ignored" });
    expect(Object.keys(env).sort()).toEqual([
      "COHORT_SEED",
      "LOG_LEVEL",
      "MAX_CONCURRENT_RUNS",
      "META_API_BASE_URL",
      "META_MODEL_SPARK",
      "MODEL_API_KEY",
      "RATE_LIMIT_PER_MINUTE",
      "RECORD_FIXTURES",
      "USE_FIXTURES",
    ]);
  });
});

describe("API protection settings", () => {
  it("defaults to 12 requests a minute and 6 concurrent runs, and accepts overrides", () => {
    const env = parseEnv({ MODEL_API_KEY: fakeMetaKey });
    expect([env.RATE_LIMIT_PER_MINUTE, env.MAX_CONCURRENT_RUNS]).toEqual([12, 6]);
    const tuned = parseEnv({
      MODEL_API_KEY: fakeMetaKey,
      RATE_LIMIT_PER_MINUTE: "30",
      MAX_CONCURRENT_RUNS: "2",
    });
    expect([tuned.RATE_LIMIT_PER_MINUTE, tuned.MAX_CONCURRENT_RUNS]).toEqual([30, 2]);
  });

  it.each([
    ["RATE_LIMIT_PER_MINUTE", "0"],
    ["RATE_LIMIT_PER_MINUTE", "abc"],
    ["RATE_LIMIT_PER_MINUTE", "1.5"],
    ["MAX_CONCURRENT_RUNS", "0"],
    ["MAX_CONCURRENT_RUNS", "-1"],
    ["MAX_CONCURRENT_RUNS", "1000"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => parseEnv({ MODEL_API_KEY: fakeMetaKey, [name]: value })).toThrow(EnvError);
  });
});

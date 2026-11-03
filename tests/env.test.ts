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
      "META_API_BASE_URL",
      "META_MODEL_SPARK",
      "MODEL_API_KEY",
      "RECORD_FIXTURES",
      "USE_FIXTURES",
    ]);
  });
});

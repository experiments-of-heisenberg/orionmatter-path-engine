/** Tests for environment validation: defaults, required keys, fixture mode, no secret leakage. */
import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "../src/lib/env";

// Deliberately fake values, used to prove error messages never echo secrets.
const fakeMetaKey = "LLM_123_supersecretvalue"; // scan-secrets:allow fake test value
const fakeBasetenKey = "baseten-secret-value"; // scan-secrets:allow fake test value
const keys = { MODEL_API_KEY: fakeMetaKey, BASETEN_API_KEY: fakeBasetenKey };

describe("parseEnv", () => {
  it("applies defaults for everything except the keys", () => {
    const env = parseEnv(keys);
    expect(env.META_API_BASE_URL).toBe("https://api.meta.ai/v1");
    expect(env.META_MODEL_SPARK).toBe("muse-spark-1.3");
    expect(env.OPEN_MODEL_ID).toBe("meta-models/muse-spark-open-1026");
    expect(env.USE_FIXTURES).toBe(false);
    expect(env.COHORT_SEED).toBe(1026);
  });

  it("requires both keys in live mode and names every missing one", () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    try {
      parseEnv({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("MODEL_API_KEY");
      expect(message).toContain("BASETEN_API_KEY");
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
      expect(message).not.toContain(fakeBasetenKey);
    }
  });
});

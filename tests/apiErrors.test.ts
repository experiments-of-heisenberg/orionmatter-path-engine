/** Tests for the API's typed errors: every failure below the API becomes a safe, stable ApiError. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, ClientClosedError, issuesOf, toApiError } from "../src/lib/api/errors";
import { IntakeImageError, IntakeInputError } from "../src/lib/intake";
import {
  FixtureMissError,
  ModelAbortedError,
  ModelConfigError,
  ModelHttpError,
  ModelNetworkError,
  ModelParseError,
  ModelTimeoutError,
} from "../src/lib/model";
import { PrivacyInputError } from "../src/lib/privacy";
import { WhatIfInputError } from "../src/lib/whatif";

describe("toApiError", () => {
  it("passes an ApiError through unchanged", () => {
    const original = new ApiError("busy", 503, "later", { retryAfter: 9 });
    expect(toApiError(original)).toBe(original);
    expect(original.toBody()).toEqual({ code: "busy", message: "later", retryAfter: 9 });
  });

  it("maps input errors to 400 and keeps their person-friendly message", () => {
    for (const error of [
      new WhatIfInputError("too long"),
      new IntakeInputError("too long"),
      new IntakeImageError("too long"),
      new PrivacyInputError("too long"),
    ]) {
      expect(toApiError(error)).toMatchObject({ code: "invalid_request", status: 400, message: "too long" });
    }
  });

  it("maps a Zod error to 400 with field-level issues, at most ten", () => {
    const schema = z.object(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, z.string()])));
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = toApiError(result.error);
    expect(mapped.code).toBe("invalid_request");
    expect(mapped.issues).toHaveLength(10);
    expect(mapped.issues?.[0]).toEqual({ path: "f0", message: expect.any(String) as string });
    expect(issuesOf(result.error)).toHaveLength(10);
  });

  it("maps an unreadable model answer to 502 and asks the client to retry", () => {
    expect(toApiError(new ModelParseError("label", "issues", "raw secret text"))).toMatchObject({
      code: "model_unreadable",
      status: 502,
      retryAfter: 2,
    });
  });

  it("maps model outages to 503 with a retry hint, using the provider's Retry-After when it sent one", () => {
    expect(toApiError(new ModelHttpError(429, "slow down", 7000))).toMatchObject({
      code: "model_unavailable",
      status: 503,
      retryAfter: 7,
    });
    expect(toApiError(new ModelHttpError(500, "boom"))).toMatchObject({ retryAfter: 5 });
    expect(toApiError(new ModelTimeoutError(5000)).code).toBe("model_unavailable");
    expect(toApiError(new ModelNetworkError("n")).code).toBe("model_unavailable");
  });

  it("maps missing configuration to 503 not_configured", () => {
    expect(toApiError(new ModelConfigError("no key"))).toMatchObject({ code: "not_configured", status: 503 });
    expect(toApiError(new FixtureMissError("label", "key")).code).toBe("not_configured");
  });

  it("maps a closed client to client_closed", () => {
    expect(toApiError(new ClientClosedError()).code).toBe("client_closed");
    expect(toApiError(new ModelAbortedError()).code).toBe("client_closed");
  });

  it("never shows the text of an unknown error: it becomes a generic 500", () => {
    const mapped = toApiError(new Error("database password is hunter2"));
    expect(mapped).toMatchObject({
      code: "internal",
      status: 500,
      message: "Something went wrong on our side.",
    });
    expect(JSON.stringify(mapped.toBody())).not.toContain("hunter2");
    expect(toApiError("a string").code).toBe("internal");
    expect(toApiError(undefined).code).toBe("internal");
  });

  it("does not leak the provider's detail text into a model_unavailable message", () => {
    const fakeKey = ["LLM", "123456", "secretvalue"].join("_"); // built from parts so the secret scanner stays quiet
    const mapped = toApiError(new ModelHttpError(500, `upstream said: key ${fakeKey} is invalid`));
    expect(JSON.stringify(mapped.toBody())).not.toContain("LLM_123456");
  });
});

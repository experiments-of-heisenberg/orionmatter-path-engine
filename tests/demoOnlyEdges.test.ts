/** The demo_only error: exact wording that leaks nothing, and clients that do not retry it. */
import { describe, expect, it } from "vitest";
import { ApiClientError, streamPost } from "../src/lib/api/client";
import { toApiError } from "../src/lib/api/errors";
import { FixtureMissError, ModelConfigError } from "../src/lib/model";

const DEMO_ONLY_MESSAGE =
  "This demo replays recorded Muse Spark answers, and that one was not recorded. Use one of the example buttons, or run the app with your own key.";

describe("demo_only edges", () => {
  it("a FixtureMissError with a 200-character label still maps to the exact demo_only message and 422", () => {
    const label = "L".repeat(200);
    const key = "k".repeat(64);
    const error = toApiError(new FixtureMissError(label, key));
    expect(error.code).toBe("demo_only");
    expect(error.status).toBe(422);
    expect(error.message).toBe(DEMO_ONLY_MESSAGE);
    expect(error.message).not.toContain(label);
    expect(error.message).not.toContain(key);
  });

  it("a ModelConfigError still maps to not_configured", () => {
    const error = toApiError(new ModelConfigError("MODEL_API_KEY is missing"));
    expect(error.code).toBe("not_configured");
    expect(error.status).toBe(503);
  });

  it("an ApiClientError built from a demo_only stream error is not retryable", async () => {
    const streamFetch = (() =>
      Promise.resolve(
        new Response('event: error\ndata: {"code":"demo_only","message":"not recorded"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )) as typeof fetch;
    const caught = await streamPost("http://x/api/plan", {}, { fetch: streamFetch }).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(caught instanceof ApiClientError)) throw new Error("expected an ApiClientError");
    expect(caught.code).toBe("demo_only");
    expect(caught.retryable).toBe(false);
  });
});

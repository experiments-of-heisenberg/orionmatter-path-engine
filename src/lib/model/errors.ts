/**
 * errors.ts: typed errors for the model client.
 *
 * Callers can branch on the class (retry, fall back to fixtures, show a toast) instead of
 * parsing message strings. `retryable` tells the client's retry loop what is worth
 * another attempt.
 */

/** Base class for every error the model layer throws on purpose. */
export class ModelError extends Error {
  /** Whether trying the same request again might succeed. */
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = new.target.name;
    this.retryable = retryable;
  }
}

/** The provider answered with a non-2xx status. */
export class ModelHttpError extends ModelError {
  readonly status: number;
  /** Server-suggested wait before retrying, from the Retry-After header. */
  readonly retryAfterMs: number | undefined;

  constructor(status: number, detail: string, retryAfterMs?: number) {
    super(`Model API returned HTTP ${status}: ${detail}`, status === 408 || status === 429 || status >= 500);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** A single attempt exceeded its timeout. */
export class ModelTimeoutError extends ModelError {
  constructor(timeoutMs: number) {
    super(`Model call timed out after ${timeoutMs} ms`, true);
  }
}

/** The request never produced an HTTP response (DNS, connection reset, ...). */
export class ModelNetworkError extends ModelError {
  constructor(detail: string) {
    super(`Network error calling model API: ${detail}`, true);
  }
}

/** The caller cancelled the request. Never retried. */
export class ModelAbortedError extends ModelError {
  constructor() {
    super("Model call was aborted by the caller");
  }
}

/** The provider replied 200 but the body was not the shape we expect. */
export class ModelProtocolError extends ModelError {
  constructor(detail: string) {
    super(`Unexpected response from model API: ${detail}`);
  }
}

/** The model produced no text and no tool calls even after raising the token budget. */
export class ModelEmptyResponseError extends ModelError {
  constructor(finishReason: string, maxCompletionTokens: number) {
    super(
      `Model returned an empty reply (finish_reason "${finishReason}", budget ${maxCompletionTokens} tokens). ` +
        "Reasoning likely consumed the whole budget.",
    );
  }
}

/** The client is missing configuration, such as an API key for a live call. */
export class ModelConfigError extends ModelError {
  constructor(detail: string) {
    super(`Model client configuration error: ${detail}`);
  }
}

/** Fixture replay was requested but no recording exists for this request. */
export class FixtureMissError extends ModelError {
  constructor(label: string, key: string) {
    super(
      `No recorded fixture for "${label}" (key ${key.slice(0, 12)}). ` +
        "Record one with RECORD_FIXTURES=true against the live API.",
    );
  }
}

/** Structured output failed validation even after the repair retry. */
export class ModelParseError extends ModelError {
  /** Human-readable validation problems from the last attempt. */
  readonly issues: string;
  /** The model's last raw reply, kept for debugging. May contain user data: do not log it. */
  readonly lastText: string;

  constructor(label: string, issues: string, lastText: string) {
    super(`Model output for "${label}" failed validation after one repair attempt:\n${issues}`);
    this.issues = issues;
    this.lastText = lastText;
  }
}

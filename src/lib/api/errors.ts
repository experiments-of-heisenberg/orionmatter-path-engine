/**
 * errors.ts: the API's typed errors and how every failure becomes one.
 *
 * A browser needs to know WHAT went wrong in a form it can act on (show a message, retry later,
 * fix the input), never a stack trace and never a model's raw reply. Everything thrown below the
 * API layer is mapped to an `ApiError` with a stable machine code, an HTTP status and a message a
 * person can read.
 */
import { z } from "zod";
import { IntakeImageError, IntakeInputError } from "../intake";
import {
  FixtureMissError,
  ModelEmptyResponseError,
  ModelProtocolError,
  ModelAbortedError,
  ModelConfigError,
  ModelHttpError,
  ModelNetworkError,
  ModelParseError,
  ModelTimeoutError,
} from "../model";
import { PrivacyInputError } from "../privacy";
import { WhatIfInputError } from "../whatif";

/** Stable machine-readable error codes. */
export type ApiErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "busy"
  | "model_unavailable"
  | "model_unreadable"
  | "not_configured"
  | "client_closed"
  | "internal";

/** What the browser receives. */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Seconds to wait before trying again, when that is the right response. */
  retryAfter?: number;
  /** Field-level problems for `invalid_request`. */
  issues?: { path: string; message: string }[];
}

/** An error the API layer throws on purpose. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfter: number | undefined;
  readonly issues: ApiErrorBody["issues"];

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    extra: { retryAfter?: number; issues?: ApiErrorBody["issues"] } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = extra.retryAfter;
    this.issues = extra.issues;
  }

  /** The JSON the browser sees. */
  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

/** Thrown inside an event emitter when the browser has gone away, to stop a run early. */
export class ClientClosedError extends Error {
  constructor() {
    super("The client closed the connection.");
    this.name = "ClientClosedError";
  }
}

/** Turn a Zod error into field-level issues. Messages are Zod's own; values are never echoed. */
export function issuesOf(error: z.ZodError): NonNullable<ApiErrorBody["issues"]> {
  return error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/**
 * Map anything thrown below the API to an ApiError.
 * Unknown errors become a generic 500: their text is not shown to the browser.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ClientClosedError || error instanceof ModelAbortedError) {
    return new ApiError("client_closed", 499, "The request was cancelled.");
  }
  if (error instanceof z.ZodError) {
    return new ApiError("invalid_request", 400, "The request is not valid.", { issues: issuesOf(error) });
  }
  if (
    error instanceof WhatIfInputError ||
    error instanceof IntakeInputError ||
    error instanceof IntakeImageError ||
    error instanceof PrivacyInputError
  ) {
    // These messages were written for people ("The text is too long ...").
    return new ApiError("invalid_request", 400, error.message);
  }
  // An answer that arrived but cannot be used (wrong shape, empty) is retryable like an unreadable one.
  if (
    error instanceof ModelParseError ||
    error instanceof ModelProtocolError ||
    error instanceof ModelEmptyResponseError
  ) {
    return new ApiError("model_unreadable", 502, "The model's answer could not be read. Please try again.", {
      retryAfter: 2,
    });
  }
  if (error instanceof ModelConfigError || error instanceof FixtureMissError) {
    return new ApiError("not_configured", 503, "The model is not configured on this server.");
  }
  if (
    error instanceof ModelHttpError ||
    error instanceof ModelTimeoutError ||
    error instanceof ModelNetworkError
  ) {
    const retryAfter =
      error instanceof ModelHttpError && error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : 5;
    return new ApiError(
      "model_unavailable",
      503,
      "The model is busy or unreachable. Please try again shortly.",
      { retryAfter },
    );
  }
  return new ApiError("internal", 500, "Something went wrong on our side.");
}

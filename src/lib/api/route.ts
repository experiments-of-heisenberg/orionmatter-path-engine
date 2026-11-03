/**
 * route.ts: the one wrapper every API route goes through.
 *
 *   request -> rate limit -> read and validate the body -> concurrency gate -> run
 *           -> JSON response, or an event stream
 *
 * Doing this in one place means no route can forget a guard, and every failure has the same shape:
 * `{ code, message, ... }` with the right HTTP status, a request id, and a log line that never
 * contains a body. Routes are plain `(Request) => Response` functions, so tests call them directly.
 */
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Emit } from "../agents";
import { readJsonBody } from "./body";
import { ApiError, toApiError } from "./errors";
import type { RateLimiter } from "./rateLimit";
import { getServices, type Services } from "./services";
import { sseResponse } from "./sse";

export type LimiterName = "model" | "plan" | "light";

export interface RouteSpec<S extends z.ZodType, R> {
  /** Short name used in logs. */
  name: string;
  schema: S;
  maxBytes: number;
  limiter: LimiterName;
  /** True when the run calls the model: it then counts against the concurrency gate. */
  usesModel: boolean;
  /** "json" returns one response; "sse" streams progress then the result. */
  mode: "json" | "sse";
  run(ctx: {
    services: Services;
    body: z.infer<S>;
    emit: Emit;
    signal: AbortSignal;
    requestId: string;
  }): Promise<R>;
}

/** A stable, anonymous label for a client, for logs. The address itself is never logged. */
export function clientLabel(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** The client's address as the platform reports it. Behind a proxy this header is set by the proxy. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** A JSON error response. */
export function errorResponse(error: ApiError, requestId: string): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  };
  if (error.retryAfter !== undefined) headers["Retry-After"] = String(error.retryAfter);
  // 499 is not a valid response status for every runtime; a closed client never sees it anyway.
  return new Response(JSON.stringify(error.toBody()), {
    status: error.status === 499 ? 400 : error.status,
    headers,
  });
}

/** Build a route handler from a spec. */
export function defineRoute<S extends z.ZodType, R>(
  spec: RouteSpec<S, R>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID();
    const services = getServices();
    const started = services.now();
    const key = clientKey(request);
    const log = (status: number, extra: Record<string, unknown> = {}): void =>
      services.logger.info("api.request", {
        requestId,
        route: spec.name,
        status,
        ms: services.now() - started,
        client: clientLabel(key),
        ...extra,
      });
    const fail = (error: unknown): Response => {
      const apiError = toApiError(error);
      services.logger[apiError.status >= 500 ? "error" : "warn"]("api.error", {
        requestId,
        route: spec.name,
        code: apiError.code,
        // Unknown errors keep their detail in the log only; the browser gets the generic message.
        ...(apiError.code === "internal" ? { detail: error } : {}),
      });
      log(apiError.status);
      return errorResponse(apiError, requestId);
    };

    let release: (() => void) | undefined;
    try {
      const limiters: Record<LimiterName, RateLimiter> = {
        model: services.modelLimiter,
        plan: services.planLimiter,
        light: services.lightLimiter,
      };
      const decision = limiters[spec.limiter].check(key);
      if (!decision.allowed) {
        throw new ApiError("rate_limited", 429, "Too many requests. Please wait a moment.", {
          retryAfter: decision.retryAfter,
        });
      }
      const body = await readJsonBody(request, spec.schema, spec.maxBytes);
      if (spec.usesModel) {
        release = services.gate.tryEnter();
        if (!release)
          throw new ApiError(
            "busy",
            503,
            "The server is busy with other requests. Please try again shortly.",
            { retryAfter: 5 },
          );
      }

      if (spec.mode === "json") {
        const result = await spec.run({
          services,
          body,
          emit: () => undefined,
          signal: request.signal,
          requestId,
        });
        log(200);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Request-Id": requestId,
          },
        });
      }

      const releaseOnFinish = release;
      release = undefined; // the stream, not this function, now owns the slot
      return sseResponse(
        (ctx) => spec.run({ services, body, emit: ctx.emit, signal: request.signal, requestId }),
        {
          requestId,
          signal: request.signal,
          headers: { "X-Request-Id": requestId },
          onFinish: (outcome) => {
            releaseOnFinish?.();
            if (outcome.ok) log(200);
            else {
              const apiError = toApiError(outcome.error);
              services.logger[apiError.status >= 500 && !outcome.closedByClient ? "error" : "warn"](
                "api.error",
                {
                  requestId,
                  route: spec.name,
                  code: apiError.code,
                  ...(apiError.code === "internal" ? { detail: outcome.error } : {}),
                },
              );
              log(outcome.closedByClient ? 499 : apiError.status, { closedByClient: outcome.closedByClient });
            }
          },
        },
      );
    } catch (error) {
      return fail(error);
    } finally {
      release?.();
    }
  };
}

/**
 * body.ts: read a JSON request body without trusting its size or its shape.
 *
 * The size limit is enforced twice: from the Content-Length header (cheap, rejects early) and while
 * reading (a client can lie about, or omit, the header). The text is only parsed once it is known
 * to be small enough, and only a Zod schema decides what the data means.
 */
import type { z } from "zod";
import { ApiError, issuesOf } from "./errors";

/** Largest body for routes that carry no image, in bytes. */
export const MAX_JSON_BYTES = 64 * 1024;
/** Largest body for the intake route, which may carry a 4 MB image as base64. */
export const MAX_INTAKE_BODY_BYTES = 6 * 1024 * 1024;

/** Read the body as text, stopping as soon as the limit is exceeded. */
async function readLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new ApiError(
      "payload_too_large",
      413,
      `The request is too large (the limit is ${Math.floor(maxBytes / 1024)} KB).`,
    );
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ApiError(
        "payload_too_large",
        413,
        `The request is too large (the limit is ${Math.floor(maxBytes / 1024)} KB).`,
      );
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/**
 * Read, size-check, parse and validate a JSON body.
 *
 * @throws ApiError 415 for a non-JSON content type, 413 for a body over the limit, 400 for bad JSON or a body that fails the schema
 */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number,
): Promise<z.infer<S>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiError("unsupported_media_type", 415, "Send the request as application/json.");
  }
  const text = await readLimited(request, maxBytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request", 400, "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_request", 400, "The request is not valid.", {
      issues: issuesOf(parsed.error),
    });
  }
  return parsed.data;
}

/** Tests for reading a request body: content type, size limits (header and stream), JSON, schema. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_INTAKE_BODY_BYTES, MAX_JSON_BYTES, readJsonBody } from "../src/lib/api/body";
import type { ApiError } from "../src/lib/api/errors";
import { post } from "./helpers/api";

const Schema = z.object({ name: z.string(), n: z.number().int().optional() }).strict();

async function failure(request: Request, max = 100): Promise<ApiError> {
  try {
    await readJsonBody(request, Schema, max);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected a failure");
}

describe("readJsonBody", () => {
  it("returns the validated data", async () => {
    expect(await readJsonBody(post("x", { name: "a", n: 2 }), Schema, 100)).toEqual({ name: "a", n: 2 });
  });

  it("accepts a content type with parameters, in any case", async () => {
    const request = post("x", { name: "a" }, { "content-type": "Application/JSON; charset=utf-8" });
    expect(await readJsonBody(request, Schema, 100)).toEqual({ name: "a" });
  });

  it("rejects a non-JSON content type with 415, before reading anything", async () => {
    const request = post("x", "name=a", { "content-type": "text/plain" });
    expect(await failure(request)).toMatchObject({ code: "unsupported_media_type", status: 415 });
    expect(await failure(new Request("http://localhost/x", { method: "POST", body: "{}" }))).toMatchObject({
      status: 415,
    });
  });

  it("rejects a body whose Content-Length is over the limit, with 413", async () => {
    const request = post("x", { name: "a" }, { "content-length": "101" });
    expect(await failure(request)).toMatchObject({ code: "payload_too_large", status: 413 });
  });

  it("rejects a body over the limit even when the header is missing or lies", async () => {
    const big = JSON.stringify({ name: "x".repeat(200) });
    expect(await failure(post("x", big))).toMatchObject({ code: "payload_too_large", status: 413 });
    expect(await failure(post("x", big, { "content-length": "5" }))).toMatchObject({ status: 413 });
  });

  it("accepts a body of exactly the limit and refuses one byte more", async () => {
    const exact = JSON.stringify({ name: "x".repeat(100 - '{"name":""}'.length) });
    expect(Buffer.byteLength(exact)).toBe(100);
    expect(await readJsonBody(post("x", exact), Schema, 100)).toEqual({ name: "x".repeat(89) });
    expect(await failure(post("x", exact + " "))).toMatchObject({ status: 413 });
  });

  it("counts bytes, not characters: multi-byte text hits the limit sooner", async () => {
    const body = JSON.stringify({ name: "é".repeat(60) }); // 120 bytes of name
    expect(await failure(post("x", body))).toMatchObject({ status: 413 });
  });

  it("rejects invalid JSON and an empty body with 400", async () => {
    expect(await failure(post("x", "{not json"))).toMatchObject({
      code: "invalid_request",
      status: 400,
      message: "The request body is not valid JSON.",
    });
    expect(await failure(post("x", ""))).toMatchObject({ code: "invalid_request", status: 400 });
  });

  it("rejects a body that fails the schema, listing the field and never echoing the value", async () => {
    const error = await failure(post("x", { name: 5, secret: "hunter2" }));
    expect(error).toMatchObject({ code: "invalid_request", status: 400 });
    expect(error.issues?.map((i) => i.path).sort()).toEqual(["", "name"]);
    expect(JSON.stringify(error.toBody())).not.toContain("hunter2");
  });

  it("rejects non-object JSON", async () => {
    for (const text of ["[]", "null", "5", '"x"'])
      expect(await failure(post("x", text))).toMatchObject({ status: 400 });
  });

  it("exposes sensible limits: 64 KB for ordinary routes, 6 MB for the image route", () => {
    expect(MAX_JSON_BYTES).toBe(65_536);
    expect(MAX_INTAKE_BODY_BYTES).toBe(6_291_456);
  });
});

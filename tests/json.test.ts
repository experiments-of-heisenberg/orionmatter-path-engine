/** Tests for JSON extraction from messy model replies. */
import { describe, expect, it } from "vitest";
import { extractJson, JsonExtractError } from "../src/lib/model/json";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a markdown fence, with or without a language tag", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson("```\n[1,2]\n```")).toEqual([1, 2]);
  });

  it("finds JSON embedded in prose", () => {
    expect(extractJson('Sure! Here is the result: {"ok": true} Hope that helps.')).toEqual({ ok: true });
  });

  it("is not fooled by braces inside strings", () => {
    expect(extractJson('Result: {"note": "use } and { carefully", "n": 2} done')).toEqual({
      note: "use } and { carefully",
      n: 2,
    });
  });

  it("handles nested structures and escaped quotes", () => {
    expect(extractJson('x {"a":{"b":[1,{"c":"say \\"hi\\""}]}} y')).toEqual({
      a: { b: [1, { c: 'say "hi"' }] },
    });
  });

  it("throws a typed error when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow(JsonExtractError);
    expect(() => extractJson('{"unterminated": ')).toThrow(JsonExtractError);
  });
});

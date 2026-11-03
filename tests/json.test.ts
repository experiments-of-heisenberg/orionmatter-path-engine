/** Tests for JSON extraction from messy model replies. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlanDraft } from "../src/lib/engine";
import { extractJson, JsonExtractError, parseModelJson } from "../src/lib/model/json";

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

  it("explains WHERE JSON-looking text is broken when the parser reports a position", () => {
    const explain = (text: string): string => {
      try {
        extractJson(text);
      } catch (error) {
        return (error as Error).message;
      }
      return "did not throw";
    };
    // An unescaped quote inside a string: a very plausible slip when a model writes prose in JSON.
    expect(explain('{"t": "he said "hi" there"}')).toMatch(
      /looks like JSON but is not valid: Expected .* at character \d+/,
    );
    expect(explain('{"a": 1,}')).toMatch(/at character \d+/);
    expect(explain('{"t": "line1\nline2"}')).toContain("Bad control character");
    expect(explain('{"a": [1, 2')).toMatch(/at character \d+/);
  });

  it("still gives the reason, without a position, for errors where the parser gives none", () => {
    expect(() => extractJson('{"a": 1, "b": [1, 2,, 3]}')).toThrow(
      /looks like JSON but is not valid: Unexpected token ','/,
    );
  });

  it("never leaks the broken text itself into the error message", () => {
    const secretish = "TOPSECRETVALUE";
    for (const broken of [`{"name": "${secretish}" "next": 1}`, `{"k": ${secretish}}`, `[${secretish}, ]`]) {
      try {
        extractJson(broken);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain(secretish);
      }
    }
  });

  it("keeps the plain message when there is nothing JSON-like at all", () => {
    expect(() => extractJson("no json here")).toThrow("no valid JSON object or array found");
  });

  it("throws a typed error when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow(JsonExtractError);
    expect(() => extractJson('{"unterminated": ')).toThrow(JsonExtractError);
  });
});

describe("recovery from a stray tail (real failure seen in live Planner runs)", () => {
  const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "model-replies", name), "utf8");

  it("recovers the real replies that ended with junk tokens, and reports it", () => {
    for (const name of ["stray-tail-1.txt", "stray-tail-2.txt"]) {
      const parsed = parseModelJson(fixture(name));
      expect(parsed.recovered).toBe(true);
      expect(parsed.droppedChars).toBeGreaterThan(0);
      expect(parsed.droppedChars).toBeLessThanOrEqual(40);
      expect(PlanDraft.safeParse(parsed.value).success).toBe(true); // the recovered draft is genuinely complete
    }
  });

  it("does NOT 'recover' the real replies with a misplaced brace in the middle: guessing intent would be unsafe", () => {
    for (const name of ["misplaced-brace-1.txt", "misplaced-brace-2.txt"]) {
      expect(() => parseModelJson(fixture(name))).toThrow(
        /looks like JSON but is not valid: .* at character \d+/,
      );
    }
  });

  it("recovers a missing closer followed by a junk token", () => {
    const parsed = parseModelJson('{"routes": [{"a": 1, "steps": [1, 2]} %}');
    expect(parsed).toEqual({
      value: { routes: [{ a: 1, steps: [1, 2] }] },
      recovered: true,
      droppedChars: 2,
    });
  });

  it("recovers when the junk contains closing brackets, as in the real 'mutated]}' tail", () => {
    expect(parseModelJson('{"x": [{"k": 1}]} mutated]}').value).toEqual({ x: [{ k: 1 }] });
  });

  it("does not report recovery for clean JSON, fenced JSON or JSON inside prose", () => {
    for (const text of ['{"a":1}', '```json\n{"a":1}\n```', 'Result: {"a":1} done']) {
      expect(parseModelJson(text)).toMatchObject({ recovered: false, droppedChars: 0 });
    }
  });

  it("refuses to recover when the dropped tail still looks like content (a quote or colon)", () => {
    expect(() => parseModelJson('{"a": [1, 2], "b": ["unfinished')).toThrow(JsonExtractError);
    expect(() => parseModelJson('{"a": [{"k": 1}] "next": 2')).toThrow(JsonExtractError);
  });

  it("refuses to recover when the tail is long", () => {
    const junk = "x".repeat(60);
    expect(() => parseModelJson(`{"a": [{"k": 1} ${junk}`)).toThrow(JsonExtractError);
  });

  it("refuses to supply more than three missing brackets", () => {
    expect(() => parseModelJson('{"a": [{"b": [{"c": [1]} junk')).toThrow(JsonExtractError);
  });

  it("can be switched off, which callers do for replies cut off by the token limit", () => {
    expect(() => parseModelJson('{"routes": [{"a": 1} %}', { recover: false })).toThrow(JsonExtractError);
  });

  it("keeps extractJson's simple signature and honours the recover option", () => {
    expect(extractJson('{"x": [{"k": 1}]} junk]}')).toEqual({ x: [{ k: 1 }] });
    expect(() => extractJson('{"x": [{"k": 1}]} junk]}', { recover: false })).not.toThrow(); // balanced block exists
    expect(() => extractJson('{"x": [{"k": 1} junk', { recover: false })).toThrow(JsonExtractError);
  });
});

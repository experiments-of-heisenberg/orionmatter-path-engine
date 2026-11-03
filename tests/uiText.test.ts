/** clip: cut text for the API's length limits without leaving half an emoji. */
import { describe, expect, it } from "vitest";
import { clip } from "../src/ui/text";

describe("clip", () => {
  it("leaves short text alone and cuts long text to the limit", () => {
    expect(clip("abc", 5)).toBe("abc");
    expect(clip("abcdef", 5)).toBe("abcde");
    expect(clip("", 3)).toBe("");
    expect(clip("abc", 3)).toBe("abc");
  });
  it("never ends on the first half of an emoji", () => {
    expect(clip("ab😀", 3)).toBe("ab");
    expect(clip("ab😀", 4)).toBe("ab😀");
    expect(clip("😀😀😀", 3)).toBe("😀");
    expect(clip("😀", 1)).toBe("");
  });
  it("counts UTF-16 units, the unit the API's limits use", () => {
    expect(clip("😀".repeat(30), 40)).toHaveLength(40);
    expect(clip("é".repeat(50), 40)).toHaveLength(40);
  });
  it("what it returns is always well-formed", () => {
    for (let max = 0; max < 8; max++) {
      const out = clip("a😀b😀c😀", max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(/[\ud800-\udbff]$/.test(out)).toBe(false);
    }
  });
});

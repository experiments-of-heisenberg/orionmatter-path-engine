/**
 * Tests for the Skeptic's prose helpers: promise-word detection, number extraction and
 * the supported/ungrounded number sets the verifier builds from cited evidence.
 */
import { describe, expect, it } from "vitest";
import {
  findOverclaim,
  mentionsLimitedEvidence,
  numbersIn,
  numericLeaves,
  supportedNumbers,
  ungroundedNumbers,
} from "../src/lib/skeptic/textChecks";

describe("findOverclaim", () => {
  it.each([
    { word: "will", text: "You will reach Staff." },
    { word: "guarantee", text: "We guarantee a promotion." },
    { word: "guaranteed", text: "A guaranteed path to Staff." },
    { word: "certain", text: "A certain path to Staff." },
    { word: "certainly", text: "This certainly leads to promotion." },
    { word: "definitely", text: "This definitely leads to promotion." },
    { word: "always", text: "It always works." },
    { word: "never", text: "It never fails." },
    { word: "ensures", text: "This ensures a promotion." },
    { word: "proven", text: "A proven route to Staff." },
    { word: "surefire", text: "A surefire way to get promoted." },
    { word: "promise", text: "We promise you will be promoted." },
  ])("returns the lower-cased word for a sentence containing '$word'", ({ word, text }) => {
    expect(findOverclaim(text)).toBe(word);
  });

  it("is case-insensitive and lower-cases what it returns", () => {
    expect(findOverclaim("This is GUARANTEED.")).toBe("guaranteed");
    expect(findOverclaim("You Will win.")).toBe("will");
  });

  it("returns the first promise word when there are several", () => {
    expect(findOverclaim("You will certainly succeed.")).toBe("will");
    expect(findOverclaim("It certainly will happen.")).toBe("certainly");
  });

  it("returns undefined for text with no promise word", () => {
    expect(findOverclaim("Twins who reached it typically took 18 to 23 months.")).toBeUndefined();
    expect(findOverclaim("")).toBeUndefined();
  });

  it.each([
    { word: "willing", text: "She is willing to lead." },
    { word: "alwaysday", text: "The alwaysday festival was fun." },
    { word: "nevertheless", text: "Nevertheless, progress continued." },
    { word: "unproven", text: "The method is unproven." },
  ])("does not match '$word' inside a longer word", ({ text }) => {
    expect(findOverclaim(text)).toBeUndefined();
  });
});

describe("numbersIn", () => {
  it.each([
    { text: "n=65", expected: [65] },
    { text: "56% to 78%", expected: [56, 78] },
    { text: "18-23 months", expected: [18, 23] },
    { text: "1.5 moves", expected: [1.5] },
  ])("extracts $expected from '$text'", ({ text, expected }) => {
    expect(numbersIn(text)).toEqual(expected);
  });

  it.each([{ text: "B4-B5" }, { text: "L6" }, { text: "ev_12" }, { text: "m_fintech" }])(
    "ignores the label '$text'",
    ({ text }) => {
      expect(numbersIn(text)).toEqual([]);
    },
  );

  it("ignores labels mixed with real numbers", () => {
    expect(numbersIn("Twins reached L6 with comp in B4-B5 (n=55).")).toEqual([55]);
  });
});

describe("numericLeaves", () => {
  it("flattens numbers from nested objects and arrays", () => {
    expect(numericLeaves({ a: 1, b: [2, { c: 3 }], d: [[4]] })).toEqual([1, 2, 3, 4]);
    expect(numericLeaves(42)).toEqual([42]);
  });

  it("ignores strings, booleans, null and non-finite numbers", () => {
    expect(numericLeaves({ s: "65", b: true, n: null, nan: NaN, inf: Infinity, ok: 7 })).toEqual([7]);
    expect(numericLeaves("65")).toEqual([]);
    expect(numericLeaves(null)).toEqual([]);
  });
});

describe("supportedNumbers", () => {
  it("supports both the fraction and the percentage form", () => {
    expect(supportedNumbers([0.56])).toEqual(new Set([0.56, 56]));
  });

  it("supports an integer only as itself", () => {
    const supported = supportedNumbers([65]);
    expect(supported.has(65)).toBe(true);
    expect(supported.size).toBe(1);
  });

  it("does not convert 0 and 1 to percentages", () => {
    const supported = supportedNumbers([0, 1]);
    expect(supported).toEqual(new Set([0, 1]));
    expect(supported.has(100)).toBe(false);
  });

  it("rounds to two decimals, so 0.1+0.2 supports 0.3", () => {
    expect(supportedNumbers([0.1 + 0.2]).has(0.3)).toBe(true);
  });
});

describe("ungroundedNumbers", () => {
  it("returns only the numbers missing from the supported set", () => {
    expect(ungroundedNumbers("18 to 23 months", supportedNumbers([18]))).toEqual([23]);
  });

  it("is empty when every number is grounded", () => {
    expect(ungroundedNumbers("56% to 78% (n=65)", supportedNumbers([0.56, 0.78, 65]))).toEqual([]);
    expect(ungroundedNumbers("no numbers here", supportedNumbers([]))).toEqual([]);
  });
});

describe("mentionsLimitedEvidence", () => {
  it("matches 'limited evidence' in any case", () => {
    expect(mentionsLimitedEvidence("based on limited evidence")).toBe(true);
    expect(mentionsLimitedEvidence("LIMITED EVIDENCE: few twins")).toBe(true);
  });

  it("does not match 'limited data'", () => {
    expect(mentionsLimitedEvidence("based on limited data")).toBe(false);
    expect(mentionsLimitedEvidence("plenty of evidence")).toBe(false);
  });
});

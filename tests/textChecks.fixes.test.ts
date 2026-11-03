/**
 * Regression tests for three bugs Muse Code found in textChecks during Part 5 (it verified each
 * by running the functions). Kept separate from its own tests so the history is traceable.
 */
import { describe, expect, it } from "vitest";
import { findOverclaim, numbersIn, ungroundedNumbers, supportedNumbers } from "../src/lib/skeptic/textChecks";

describe("numbersIn: digits glued to a following letter are not numbers", () => {
  it.each([
    ["the 1st step", []],
    ["meet at 6pm", []],
    ["2nd and 3rd moves", []],
    ["a 10x engineer", []],
  ])("%s", (text, expected) => {
    expect(numbersIn(text)).toEqual(expected);
  });

  it("does not backtrack to a partial match: '65x' must not yield 6", () => {
    expect(numbersIn("65x")).toEqual([]);
    expect(numbersIn("1.5x")).toEqual([]);
    expect(numbersIn("1,000x")).toEqual([]);
  });

  it("still reads numbers followed by punctuation, percent signs and a sentence-ending full stop", () => {
    expect(numbersIn("n=65.")).toEqual([65]);
    expect(numbersIn("56% to 78%")).toEqual([56, 78]);
    expect(numbersIn("(18-23 months)")).toEqual([18, 23]);
    expect(numbersIn("steps: 1, 2 and 3")).toEqual([1, 2, 3]);
  });

  it("does not turn an ordinal into a spurious ungrounded-number finding", () => {
    expect(ungroundedNumbers("In the 1st step, twins (n=65) moved.", supportedNumbers([65]))).toEqual([]);
  });
});

describe("numbersIn: thousands separators", () => {
  it("reads 1,000 as one thousand, not as 1 and 0", () => {
    expect(numbersIn("1,000 engineers")).toEqual([1000]);
    expect(numbersIn("about 12,345.5 in total")).toEqual([12345.5]);
    expect(numbersIn("2,000,000 tokens")).toEqual([2000000]);
  });

  it("does not merge a plain comma-separated list into one number", () => {
    expect(numbersIn("1,2,3")).toEqual([1, 2, 3]);
    expect(numbersIn("65, 12")).toEqual([65, 12]);
  });

  it("a grounded thousands figure passes the grounding check", () => {
    expect(ungroundedNumbers("from 1,000 comparable engineers", supportedNumbers([1000]))).toEqual([]);
  });
});

describe("findOverclaim: hyphenated compounds are not promises", () => {
  it.each([
    "will-power",
    "always-on rotation",
    "a never-ending queue",
    "ever-certain",
    "the no-guarantee clause",
  ])("does not flag %s", (text) => {
    expect(findOverclaim(text)).toBeUndefined();
  });

  it("still flags real promises, including next to punctuation", () => {
    expect(findOverclaim("You will reach it.")).toBe("will");
    expect(findOverclaim("(guaranteed)")).toBe("guaranteed");
    expect(findOverclaim("It always works; never fails")).toBe("always");
    expect(findOverclaim("WILL happen")).toBe("will");
  });

  it("does not flag words that merely contain a promise word", () => {
    expect(findOverclaim("willing to relocate")).toBeUndefined();
    expect(findOverclaim("unproven approach")).toBeUndefined();
    expect(findOverclaim("nevertheless")).toBeUndefined();
  });
});

/** Edge cases for the limits helpers: hostile numbers, unicode skills, raw wording, and wrong-typed relaxations. */
import { describe, expect, it } from "vitest";
import type { Constraints } from "../src/lib/schemas";
import type { Relaxation } from "../src/lib/whatif";
import {
  LIMIT_MAX,
  LIMIT_MIN,
  applyRelaxation,
  cleanSkill,
  describeConstraints,
  limitLabel,
  limitToSlider,
  normalise,
  sameConstraints,
  sliderToLimit,
  withLimit,
} from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";

const base = SAMPLE_PERSON.constraints;

describe("slider mapping at the edges", () => {
  it("maps positions the slider cannot produce: negatives clamp, infinities mean no limit", () => {
    expect(sliderToLimit(-5)).toBe(LIMIT_MIN);
    expect(sliderToLimit(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(sliderToLimit(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });

  it("rounds 72.5 up and then clamps to the longest limit, while 73.4 means no limit", () => {
    // Math.round(72.5) is 73, but 73 is the "no limit" stop, so the value clamps to 72.
    expect(sliderToLimit(72.5)).toBe(LIMIT_MAX);
    expect(sliderToLimit(73.4)).toBeUndefined();
  });

  it("limitToSlider clamps zero and negatives to the first stop", () => {
    expect(limitToSlider(0)).toBe(LIMIT_MIN);
    expect(limitToSlider(-3)).toBe(LIMIT_MIN);
  });

  it("limitToSlider(NaN) is NaN, and the label then reads 'NaN months'", () => {
    // NaN survives the clamping (Math.max/min of NaN is NaN). The slider input itself would
    // sanitise an invalid value, but the output next to it would read "NaN months", so a NaN
    // limit must never be stored. Reported: withLimit below is the one place that can store it.
    expect(Number.isNaN(limitToSlider(Number.NaN))).toBe(true);
    expect(limitLabel(Number.NaN)).toBe("NaN months");
  });
});

describe("withLimit with hostile numbers", () => {
  it("clamps infinities into range", () => {
    expect(withLimit(base, Number.POSITIVE_INFINITY).maxMonths).toBe(240);
    expect(withLimit(base, Number.NEGATIVE_INFINITY).maxMonths).toBe(1);
  });

  it("withLimit(NaN) stores NaN: outside 1..240, non-integer, and null on the wire", () => {
    // Reported: Math.round(NaN) is NaN and the clamp cannot catch it, so maxMonths becomes NaN.
    // JSON.stringify turns NaN into null, so the API would receive maxMonths: null and reject it.
    const next = withLimit(base, Number.NaN).maxMonths;
    expect(Number.isNaN(next)).toBe(true);
    expect(JSON.stringify({ maxMonths: next })).toBe('{"maxMonths":null}');
  });
});

describe("normalise and sameConstraints", () => {
  it("normalise drops unknown extra keys rather than keeping them", () => {
    const withExtra = { ...base, whatever: 1 } as unknown as Constraints;
    expect("whatever" in normalise(withExtra)).toBe(false);
  });

  it("sameConstraints compares skills case-sensitively: 'Rust' is not 'rust'", () => {
    // In practice both sides pass through cleanSkill first, so this only matters for hand-built objects.
    expect(sameConstraints({ ...base, addSkills: ["Rust"] }, { ...base, addSkills: ["rust"] })).toBe(false);
  });
});

describe("cleanSkill with punctuation, unicode and emoji", () => {
  it("keeps a punctuation-only name as-is", () => {
    expect(cleanSkill("!!!")).toBe("!!!");
  });

  it("lower-cases unicode and keeps non-latin scripts", () => {
    expect(cleanSkill("Café")).toBe("café");
    expect(cleanSkill("日本語")).toBe("日本語");
  });

  it("slice(0, 40) can split a surrogate pair: this input ends in a lone high surrogate", () => {
    // Reported: 39 units plus one emoji (2 units) cut at 40 units keeps only the emoji's first half.
    const cleaned = cleanSkill("x".repeat(39) + "😀");
    expect(cleaned).toHaveLength(40);
    expect(/[\ud800-\udbff]$/.test(cleaned)).toBe(true);
  });
});

describe("describeConstraints returns raw text", () => {
  it("names low and high risk and leaves skill markup unescaped for the renderer", () => {
    expect(describeConstraints({ ...base, riskTolerance: "low" })).toEqual(["Low risk tolerance"]);
    const words = describeConstraints({ ...base, riskTolerance: "high", addSkills: ["<img src=x>"] });
    expect(words).toContain("High risk tolerance");
    // Raw "<img src=x>", not an entity: escaping is the renderer's job (React escapes it).
    expect(words).toContain("Asking about <img src=x>");
  });
});

describe("applyRelaxation with null, undefined and wrong-typed values", () => {
  const knobs = ["maxMonths", "minCompBand", "remote", "noRelocation"] as const;

  it("never throws and never changes the input for values of the wrong kind", () => {
    const wrong: Record<(typeof knobs)[number], unknown[]> = {
      maxMonths: [null, undefined, "soon", true],
      minCompBand: [undefined, 42, true, "B9"],
      remote: [null, undefined, 42, "off", true],
      noRelocation: [null, undefined, 42, "off", true],
    };
    for (const knob of knobs) {
      for (const value of wrong[knob]) {
        const before = structuredClone(base);
        const next = applyRelaxation(base, { knob, value: value as Relaxation["value"] });
        expect(next).toEqual(base);
        expect(base).toEqual(before);
      }
    }
  });

  it("treats minCompBand null as 'no floor': clearing an unset floor changes nothing", () => {
    expect(applyRelaxation(base, { knob: "minCompBand", value: null })).toEqual(base);
  });

  it("a relaxation of a switch always turns it off, even when the value says otherwise", () => {
    // The value is ignored on purpose; there is no "relax towards on".
    expect(applyRelaxation(base, { knob: "remote", value: true as unknown as false })).toEqual(base);
  });
});

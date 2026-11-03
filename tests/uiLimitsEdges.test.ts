/** Edge cases for the limits helpers: hostile numbers, unicode skills, raw wording, and wrong-typed relaxations. */
import { describe, expect, it } from "vitest";
import type { Constraints } from "../src/lib/schemas";
import type { Relaxation } from "../src/lib/whatif";
import {
  LIMIT_MAX,
  LIMIT_MIN,
  NO_LIMIT,
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

  it("limitToSlider and limitLabel treat a value that is not a number as 'no limit' (review fix)", () => {
    expect(limitToSlider(Number.NaN)).toBe(NO_LIMIT);
    expect(limitToSlider(Number.POSITIVE_INFINITY)).toBe(NO_LIMIT);
    expect(limitLabel(Number.NaN)).toBe("No limit");
  });
});

describe("withLimit with hostile numbers", () => {
  it("a value that is not a finite number changes nothing (review fix: it used to store NaN, which the API receives as null)", () => {
    const set = { ...base, maxMonths: 24 };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(withLimit(set, bad)).toEqual(set);
      expect(withLimit(base, bad)).toEqual(base);
    }
  });

  it("every limit that can be stored is a whole number from 1 to 240", () => {
    for (const months of [-5, 0, 0.4, 1.5, 23.6, 240, 241, 99999]) {
      const stored = withLimit(base, months).maxMonths;
      expect(Number.isInteger(stored)).toBe(true);
      expect(stored).toBeGreaterThanOrEqual(1);
      expect(stored).toBeLessThanOrEqual(240);
    }
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

  it("never leaves half an emoji at the end when the name is cut (review fix)", () => {
    const cleaned = cleanSkill("x".repeat(39) + "😀");
    expect(cleaned).toBe("x".repeat(39));
    expect(/[\ud800-\udbff]$/.test(cleaned)).toBe(false);
    expect(cleanSkill("x".repeat(38) + "😀")).toHaveLength(40); // a whole emoji that fits is kept
    expect(JSON.parse(JSON.stringify(cleaned))).toBe(cleaned); // survives the trip to the server
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

describe("applyRelaxation with an unknown knob (review fix)", () => {
  it("returns the settings unchanged instead of undefined", () => {
    const c = { ...base, maxMonths: 12 };
    const next = applyRelaxation(c, { knob: "colour" as unknown as "remote", value: false });
    expect(next).toEqual(c);
  });
});

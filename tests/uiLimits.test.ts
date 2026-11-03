/** The limits helpers: slider mapping, immutable normalised edits, wording, and applying a "what would it take" suggestion. */
import { describe, expect, it } from "vitest";
import { MAX_SKILLS } from "../src/lib/schemas";
import { whatWouldItTake } from "../src/lib/whatif";
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
  withFlag,
  withLimit,
  withMinBand,
  withRisk,
  withSkillAdded,
  withSkillRemoved,
} from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";

const base = SAMPLE_PERSON.constraints;

describe("the time-limit slider", () => {
  it("puts 'no limit' at the last stop and maps both ways", () => {
    expect(NO_LIMIT).toBe(LIMIT_MAX + 1);
    expect(limitToSlider(undefined)).toBe(NO_LIMIT);
    expect(sliderToLimit(NO_LIMIT)).toBeUndefined();
    for (const months of [LIMIT_MIN, 12, 24, 60, LIMIT_MAX])
      expect(sliderToLimit(limitToSlider(months))).toBe(months);
  });

  it("clamps limits the slider cannot show to its ends, and positions outside it too", () => {
    expect(limitToSlider(1)).toBe(LIMIT_MIN);
    expect(limitToSlider(240)).toBe(LIMIT_MAX);
    expect(sliderToLimit(0)).toBe(LIMIT_MIN);
    expect(sliderToLimit(500)).toBeUndefined();
    expect(sliderToLimit(Number.NaN)).toBeUndefined();
    expect(sliderToLimit(23.6)).toBe(24);
  });

  it("labels the limit in words, singular for one month", () => {
    expect(limitLabel(undefined)).toBe("No limit");
    expect(limitLabel(1)).toBe("1 month");
    expect(limitLabel(24)).toBe("24 months");
  });
});

describe("edits are immutable and normalised", () => {
  it("withLimit sets, clears and bounds the limit without touching the input", () => {
    const before = structuredClone(base);
    expect(withLimit(base, 24).maxMonths).toBe(24);
    expect(withLimit({ ...base, maxMonths: 24 }, undefined)).toEqual(base);
    expect(withLimit(base, 0).maxMonths).toBe(1);
    expect(withLimit(base, 999).maxMonths).toBe(240);
    expect(withLimit(base, 23.6).maxMonths).toBe(24);
    expect(base).toEqual(before);
  });

  it("a switch that is off is absent, never false, so equal settings compare equal", () => {
    const on = withFlag(base, "remote", true);
    expect(on.remote).toBe(true);
    const off = withFlag(on, "remote", false);
    expect("remote" in off).toBe(false);
    expect(off).toEqual(base);
    expect(normalise({ ...base, remote: false, noRelocation: false })).toEqual(base);
  });

  it("sets and clears the pay floor and the risk", () => {
    expect(withMinBand(base, "B4").minCompBand).toBe("B4");
    expect("minCompBand" in withMinBand({ ...base, minCompBand: "B4" }, undefined)).toBe(false);
    expect(withRisk(base, "low").riskTolerance).toBe("low");
  });

  it("skills: cleaned, no blanks, no repeats, at most MAX_SKILLS, removable", () => {
    expect(cleanSkill("  Rust  ")).toBe("rust");
    expect(cleanSkill("a\n\tb   c")).toBe("a b c");
    expect(cleanSkill("x".repeat(80))).toHaveLength(40);
    let c = withSkillAdded(base, " Rust ");
    expect(c.addSkills).toEqual(["rust"]);
    expect(withSkillAdded(c, "RUST").addSkills).toEqual(["rust"]);
    expect(withSkillAdded(c, "   ").addSkills).toEqual(["rust"]);
    for (let i = 0; i < 10; i++) c = withSkillAdded(c, `skill${i}`);
    expect(c.addSkills).toHaveLength(MAX_SKILLS);
    expect(withSkillRemoved(c, "rust").addSkills).not.toContain("rust");
    expect(withSkillRemoved(c, "nothing")).toEqual(c);
  });
});

describe("sameConstraints", () => {
  it("ignores keys that mean 'not set' and compares skills in order", () => {
    expect(sameConstraints(base, { ...base, remote: false })).toBe(true);
    expect(sameConstraints(base, withLimit(base, 24))).toBe(false);
    expect(sameConstraints({ ...base, addSkills: ["a", "b"] }, { ...base, addSkills: ["b", "a"] })).toBe(
      false,
    );
    expect(sameConstraints({ ...base, addSkills: ["a"] }, { ...base, addSkills: ["a", "b"] })).toBe(false);
    expect(sameConstraints({ ...base, riskTolerance: "low" }, base)).toBe(false);
  });
});

describe("describeConstraints", () => {
  it("is empty when nothing is set and lists each setting in words otherwise", () => {
    expect(describeConstraints(base)).toEqual([]);
    expect(
      describeConstraints({
        riskTolerance: "high",
        addSkills: ["rust"],
        maxMonths: 24,
        minCompBand: "B4",
        remote: true,
        noRelocation: true,
      }),
    ).toEqual([
      "Within 24 months",
      "Pay B4 or higher",
      "Remote only",
      "No relocation",
      "High risk tolerance",
      "Asking about rust",
    ]);
    expect(describeConstraints({ ...base, riskTolerance: "low" })).toEqual(["Low risk tolerance"]);
  });
});

describe("applyRelaxation uses the structured value of a real suggestion", () => {
  const input = { profile: SAMPLE_PERSON.profile, goal: SAMPLE_PERSON.goal };

  it("raises the time limit to the smallest limit that works", () => {
    const start = { ...base, maxMonths: 12 };
    const take = whatWouldItTake({ ...input, constraints: start });
    const option = take.options.find((o) => o.knob === "maxMonths");
    expect(option?.value).toBe(23);
    const next = applyRelaxation(start, option as NonNullable<typeof option>);
    expect(next.maxMonths).toBe(23);
    expect(whatWouldItTake({ ...input, constraints: next }).alreadyMet).toBe(true);
  });

  it("drops the pay floor or lowers it to a band, and switches a switch off", () => {
    const strict = { ...base, minCompBand: "B5", remote: true, noRelocation: true, maxMonths: 12 };
    expect(applyRelaxation(strict, { knob: "minCompBand", value: null }).minCompBand).toBeUndefined();
    expect(applyRelaxation(strict, { knob: "minCompBand", value: "B3" }).minCompBand).toBe("B3");
    expect("remote" in applyRelaxation(strict, { knob: "remote", value: false })).toBe(false);
    expect("noRelocation" in applyRelaxation(strict, { knob: "noRelocation", value: false })).toBe(false);
  });

  it("ignores a value of the wrong kind rather than corrupting the settings", () => {
    const c = { ...base, maxMonths: 12, minCompBand: "B4" };
    expect(applyRelaxation(c, { knob: "maxMonths", value: "soon" })).toEqual(c);
    expect(applyRelaxation(c, { knob: "minCompBand", value: "B9" })).toEqual(c);
  });
});

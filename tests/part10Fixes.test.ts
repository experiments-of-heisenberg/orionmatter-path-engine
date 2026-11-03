/** Regression tests for the Part 10 review findings (each confirmed by a probe from Muse Code's bug hunt). */
import { describe, expect, it } from "vitest";
import { createMockClient } from "../src/lib/model";
import {
  assessPrivacy,
  detectIdentifiers,
  generalise,
  PrivacyInputError,
  type PrivacyFinding,
} from "../src/lib/privacy";
import { goal, profile } from "./helpers/fixturesData";

const f = (quote: string, category: PrivacyFinding["category"]): PrivacyFinding => ({
  quote,
  category,
  reason: "r",
  source: "model",
});

describe("generalise never corrupts a placeholder it inserted", () => {
  it("does not match a later quote inside an earlier placeholder", () => {
    expect(
      generalise("I joined Acme Corporation today", [
        f("Acme Corporation", "employer"),
        f("company", "other"),
      ]),
    ).toBe("I joined [a company] today");
    expect(
      generalise("I joined Acme Corporation today", [f("Acme Corporation", "employer"), f("a", "other")]),
    ).toBe("I joined [a company] today");
    expect(generalise("x Acme y", [f("Acme", "employer"), f("detail", "other"), f("a", "other")])).toBe(
      "x [a company] y",
    );
  });

  it("still replaces a short quote where it stands alone, even next to a longer one", () => {
    expect(
      generalise("Acme Robotics hired a person at Acme", [
        f("Acme Robotics", "employer"),
        f("Acme", "employer"),
        f("a", "other"),
      ]),
    ).toBe("[a company] hired [a detail] person at [a company]");
  });

  it("keeps the first-claimed category when two quotes cover the same words", () => {
    expect(generalise("Acme Robotics", [f("Acme Robotics", "employer"), f("acme robotics", "other")])).toBe(
      "[a company]",
    );
  });

  it("is a single pass: text with no findings or no match comes back unchanged", () => {
    expect(generalise("nothing here", [])).toBe("nothing here");
    expect(generalise("nothing here", [f("absent", "other")])).toBe("nothing here");
  });
});

describe("k must be a whole number of at least 1", () => {
  it.each([0, -3, 2.5, Number.NaN])(
    "assessPrivacy refuses k = %s with a typed error and no model call",
    async (k) => {
      const client = createMockClient([]);
      await expect(assessPrivacy({ client }, { profile, goal, k })).rejects.toThrow(PrivacyInputError);
      expect(client.requests).toHaveLength(0);
    },
  );

  it("accepts k = 1 and a large k", async () => {
    const client = createMockClient([]);
    expect((await assessPrivacy({ client }, { profile, goal, k: 1 })).risk).toBe("low");
    expect((await assessPrivacy({ client }, { profile, goal, k: 25 })).reasons.join(" ")).toContain(
      "a crowd of 25 or more",
    );
  });
});

describe("detector wording and coverage (review findings)", () => {
  it("says 'An email address', 'A phone number' and 'A link'", () => {
    const reasons = detectIdentifiers("a@b.com, +1 415 555 0134, https://x.com/a").map((x) => x.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "An email address points straight at you.",
        "A phone number points straight at you.",
        "A link points straight at you.",
      ]),
    );
  });

  it("flags lower-case and mixed-case currency codes", () => {
    expect(detectIdentifiers("earned 120000 usd and 90,000 Eur").map((x) => x.quote)).toEqual([
      "120000 usd",
      "90,000 Eur",
    ]);
  });
});

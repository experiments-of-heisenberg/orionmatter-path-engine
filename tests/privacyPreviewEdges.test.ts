/**
 * Edge tests for generalise, phraseRegex and PLACEHOLDERS: overlapping and repeated quotes,
 * boundary and spacing behaviour, quotes made of regex metacharacters, skips, Unicode, the
 * placeholder table itself, idempotence and speed on a full-length text with many findings.
 */
import { describe, expect, it } from "vitest";
import { generalise, phraseRegex, PLACEHOLDERS } from "../src/lib/privacy";
import type { PrivacyFinding } from "../src/lib/privacy";

/** A model finding with a fixed reason, for readability. */
function finding(quote: string, category: PrivacyFinding["category"]): PrivacyFinding {
  return { quote, category, reason: "r", source: "model" };
}

describe("generalise overlaps", () => {
  it("replaces overlapping quotes longest first", () => {
    expect(
      generalise("Acme Robotics and Robotics and Acme", [
        finding("Acme", "employer"),
        finding("Acme Robotics", "employer"),
        finding("Robotics", "project_or_product"),
      ]),
    ).toBe("[a company] and [a project] and [a company]");
  });

  it("lets the finding listed first win when the same quote has two categories (stated)", () => {
    // Equal lengths keep input order (stable sort), and the first replacement consumes the
    // text, so the second finds nothing. The Guard never produces this shape (it dedupes
    // case-insensitively), but the order-dependence is stated.
    expect(generalise("Acme", [finding("Acme", "employer"), finding("Acme", "school")])).toBe("[a company]");
    expect(generalise("Acme", [finding("Acme", "school"), finding("Acme", "employer")])).toBe("[a school]");
  });

  it("replaces a quote that appears three times, at the start and at the end", () => {
    expect(generalise("Acme and Acme and Acme", [finding("Acme", "employer")])).toBe(
      "[a company] and [a company] and [a company]",
    );
  });

  it("replaces next to punctuation but not inside a longer word", () => {
    expect(generalise("(Acme), 'Acme'; Acme.", [finding("Acme", "employer")])).toBe(
      "([a company]), '[a company]'; [a company].",
    );
    expect(generalise("AcmeCorp and Acme", [finding("Acme", "employer")])).toBe("AcmeCorp and [a company]");
  });

  it("ignores case and runs of whitespace, including tabs and newlines", () => {
    expect(generalise("ACME acme Acme", [finding("Acme", "employer")])).toBe(
      "[a company] [a company] [a company]",
    );
    expect(generalise("Acme\tRobotics and Acme\nRobotics", [finding("Acme Robotics", "employer")])).toBe(
      "[a company] and [a company]",
    );
  });
});

describe("generalise metacharacters", () => {
  it.each([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"])(
    "treats %s as a literal: no throw, no changed matching",
    (char) => {
      expect(generalise(`x a${char}b y`, [finding(`a${char}b`, "other")])).toBe("x [a detail] y");
    },
  );

  it("replaces $-patterns such as $& and $1 without interpreting them", () => {
    // The quote is pattern-side (escaped) and the placeholder has no $, so String.replace
    // treats neither as a $-substitution.
    expect(generalise("cost is $& today", [finding("$&", "other")])).toBe("cost is [a detail] today");
    expect(generalise("cost is $1 today", [finding("$1", "other")])).toBe("cost is [a detail] today");
  });
});

describe("generalise skips", () => {
  it("skips a whitespace-only or empty quote without changing the text", () => {
    expect(generalise("hello world", [finding("   ", "other")])).toBe("hello world");
    expect(generalise("hello world", [finding("", "other")])).toBe("hello world");
  });

  it("returns the text unchanged for an empty findings list", () => {
    expect(generalise("hello world", [])).toBe("hello world");
  });

  it('leaves "[a company]" intact when a later quote is "company" (stated)', () => {
    // "company" (7 chars) sorts before "Acme" (4), finds nothing in the original text, and
    // then "Acme" is replaced: this order is safe. A LONGER first quote ("Acme Corporation")
    // followed by "company" DOES corrupt the placeholder ("[a [a detail]]"): reported as a bug.
    expect(
      generalise("I joined Acme today", [finding("Acme", "employer"), finding("company", "other")]),
    ).toBe("I joined [a company] today");
  });
});

describe("generalise Unicode", () => {
  it("replaces accented quotes and leaves emoji and right-to-left text alone", () => {
    expect(generalise("I love café and Zoë", [finding("café", "other"), finding("Zoë", "person_name")])).toBe(
      "I love [a detail] and [a person]",
    );
    expect(generalise("hello 🎉 Acme 🎉", [finding("Acme", "employer")])).toBe("hello 🎉 [a company] 🎉");
    expect(generalise("مرحبا Acme بالعالم", [finding("Acme", "employer")])).toBe("مرحبا [a company] بالعالم");
  });
});

describe("generalise idempotence and speed", () => {
  it("changes nothing when generalising already-generalised text with the same findings", () => {
    const findings = [finding("Zephyr", "project_or_product"), finding("Acme Robotics", "employer")];
    const once = generalise("I led Zephyr at Acme Robotics.", findings);
    expect(generalise(once, findings)).toBe(once);
  });

  it("handles a 3000-character text with 20 findings quickly", () => {
    const text = "word Acme Zephyr café Maple Street team alpha beta gamma delta ".repeat(60).slice(0, 3000);
    expect(text).toHaveLength(3000);
    const quotes = [
      "Acme",
      "Zephyr",
      "café",
      "Maple",
      "Street",
      "team",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "word",
      "w1",
      "w2",
      "w3",
      "w4",
      "w5",
      "w6",
      "w7",
      "w8",
      "w9",
    ];
    const started = performance.now();
    const out = generalise(
      text,
      quotes.map((quote) => finding(quote, "other")),
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toContain("[a detail]");
  });
});

describe("phraseRegex and PLACEHOLDERS", () => {
  it("matches whole words, any case, any spacing between words", () => {
    expect(phraseRegex("Acme").test("ACME")).toBe(true);
    expect(phraseRegex("Acme").test("AcmeCorp")).toBe(false);
    expect(phraseRegex("a b").test("a  b")).toBe(true);
    expect(phraseRegex("a b").test("a\tb")).toBe(true);
  });

  it("pins the exact placeholder for every category", () => {
    expect(PLACEHOLDERS).toEqual({
      contact_detail: "[contact detail removed]",
      exact_date: "[a date]",
      exact_compensation: "[a pay figure]",
      person_name: "[a person]",
      employer: "[a company]",
      project_or_product: "[a project]",
      school: "[a school]",
      location_detail: "[a place]",
      small_team_detail: "[a team detail]",
      unique_achievement: "[an achievement]",
      other: "[a detail]",
    });
  });
});

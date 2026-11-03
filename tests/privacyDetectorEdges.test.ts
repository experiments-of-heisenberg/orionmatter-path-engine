/**
 * Edge tests for detectIdentifiers and findPii: date and pay spellings the core tests do not
 * pin down, what the patterns deliberately (or accidentally) miss, contact shapes, the shape
 * every finding keeps, and that a full-length mixed input is processed quickly.
 */
import { describe, expect, it } from "vitest";
import { findPii } from "../src/lib/intake/redact";
import { detectIdentifiers } from "../src/lib/privacy";

/** Quotes of the findings in `text`, in order. */
function quotes(text: string): string[] {
  return detectIdentifiers(text).map((f) => f.quote);
}

describe("detectIdentifiers dates", () => {
  it.each([
    ["ISO", "Joined on 2023-03-15 ok", "2023-03-15"],
    ["month first with ordinal", "left March 3rd, 2024 ok", "March 3rd, 2024"],
    ["day first with ordinal", "left 3rd March 2024 ok", "3rd March 2024"],
    ["day first without ordinal", "left 4 June 2022 ok", "4 June 2022"],
    ["short September", "left Sept 5, 2021 ok", "Sept 5, 2021"],
    ["abbreviation with full stop", "left Jan. 5, 2020 ok", "Jan. 5, 2020"],
    ["abbreviation without full stop", "left Sep 5, 2021 ok", "Sep 5, 2021"],
  ])("flags a %s date", (_label, text, expected) => {
    expect(quotes(text)).toEqual([expected]);
  });

  it("does not flag a month and year on its own", () => {
    expect(detectIdentifiers("Promoted in March 2023 ok")).toEqual([]);
  });

  it("flags numeric slash and dash dates in UK, US and year-first order (review finding)", () => {
    expect(quotes("on 15/03/2023 ok")).toEqual(["15/03/2023"]);
    expect(quotes("on 03-15-2023 ok")).toEqual(["03-15-2023"]);
    expect(quotes("on 2023/03/15 ok")).toEqual(["2023/03/15"]);
    expect(quotes("version 1.2.3 and ratio 3/4 and 12/2023")).toEqual([]); // not dates
  });

  it("keeps the full stop that ends a sentence outside the match", () => {
    expect(quotes("Joined on 2023-03-15.")).toEqual(["2023-03-15"]);
    expect(quotes("Joined March 3rd, 2024.")).toEqual(["March 3rd, 2024"]);
    expect(quotes("left 4 June 2022.")).toEqual(["4 June 2022"]);
  });

  it("flags 1999-13-45: there is no calendar validation (stated, not asserted as correct)", () => {
    // Month 13 and day 45 do not exist, but the ISO pattern counts digits, not dates.
    // Harmless in practice (an invalid date is still an oddly specific string), but stated.
    expect(quotes("on 1999-13-45 ok")).toEqual(["1999-13-45"]);
    expect(quotes("on 2023-00-10 ok")).toEqual(["2023-00-10"]);
  });
});

describe("detectIdentifiers pay", () => {
  it.each([
    ["dollar thousands", "Earned $180k ok", "$180k"],
    ["dollar full figure", "Earned $180,000 ok", "$180,000"],
    ["dollar millions", "Earned $1.5M ok", "$1.5M"],
    ["euro thousands", "Earned €90k ok", "€90k"],
    ["pounds before a full stop", "Earned £70,000. ok", "£70,000"],
    ["rupees Indian grouping", "Earned ₹45,00,000 ok", "₹45,00,000"],
    ["LPA spaced", "Earned 45 LPA ok", "45 LPA"],
    ["LPA unspaced", "Earned 45LPA ok", "45LPA"],
    ["USD code", "Earned 120000 USD ok", "120000 USD"],
    ["INR code with grouping", "Earned 120,000 INR ok", "120,000 INR"],
  ])("flags %s (%s)", (_label, text, expected) => {
    expect(quotes(text)).toEqual([expected]);
  });

  it("keeps the full stop that ends a sentence outside a pay match", () => {
    expect(quotes("Earned $180k.")).toEqual(["$180k"]);
    expect(quotes("Earned 45 LPA.")).toEqual(["45 LPA"]);
  });

  it('flags "I have 3 USD": any amount with a unit counts, however small (stated)', () => {
    expect(quotes("I have 3 USD")).toEqual(["3 USD"]);
  });

  it('does not flag bare numbers: "180k" without a symbol or unit is missed (stated)', () => {
    expect(detectIdentifiers("I have 180 apples")).toEqual([]);
    // "180k" reads as pay to a person, but no pattern matches a bare number: by design for
    // plain numbers, a false negative for suffixed ones. Listed in the Part 10 docs page.
    expect(detectIdentifiers("I have 180k apples")).toEqual([]);
  });
});

describe("detectIdentifiers contact details", () => {
  it("finds an email next to punctuation without the punctuation", () => {
    expect(quotes("Mail (jo@x.com), ok.")).toEqual(["jo@x.com"]);
  });

  it("finds a link inside brackets without the brackets", () => {
    expect(quotes("See [https://x.com/a] end")).toEqual(["https://x.com/a"]);
  });

  it("keeps the leading bracket of a parenthesised phone number", () => {
    expect(quotes("call (415) 555-0134 now")).toEqual(["(415) 555-0134"]);
  });

  it("does not treat an IPv4 address as a phone number", () => {
    expect(detectIdentifiers("server 192.168.1.100 is up")).toEqual([]);
  });

  it("reports links before emails before phones, with the original text", () => {
    const found = findPii("Mail a@b.com see https://x.com/a call 415-555-0134");
    expect(found.map((m) => m.kind)).toEqual(["link", "email", "phone"]);
    expect(found.map((m) => m.text)).toEqual(["https://x.com/a", "a@b.com", "415-555-0134"]);
  });
});

describe("detectIdentifiers shape", () => {
  it("reports the same detail written twice in different case once, keeping the first (stated)", () => {
    const found = detectIdentifiers("A@B.com and a@b.com");
    expect(found).toHaveLength(1);
    expect(found[0]?.quote).toBe("A@B.com");
  });

  it("gives every finding source code, a verbatim quote and a reason", () => {
    const text = "Mail jo@x.com, joined 2023-03-15 on $180k, see https://x.com/a.";
    const found = detectIdentifiers(text);
    expect(found.length).toBeGreaterThan(0);
    for (const finding of found) {
      expect(finding.source).toBe("code");
      expect(finding.quote.length).toBeGreaterThan(0);
      expect(text).toContain(finding.quote);
      expect(finding.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("detectIdentifiers performance and empties", () => {
  it("processes 3000 mixed characters in well under a second", () => {
    const chunk = "Call 415-555-0134 or mail jo@x.com on 2023-03-15 for $180k! 15/03/2023 ... ";
    const text = chunk.repeat(Math.ceil(3000 / chunk.length)).slice(0, 3000);
    expect(text).toHaveLength(3000);
    const started = performance.now();
    const found = detectIdentifiers(text);
    const elapsed = performance.now() - started;
    expect(found.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it("returns an empty list for empty and whitespace-only strings", () => {
    expect(detectIdentifiers("")).toEqual([]);
    expect(detectIdentifiers("   ")).toEqual([]);
    expect(findPii("")).toEqual([]);
  });
});

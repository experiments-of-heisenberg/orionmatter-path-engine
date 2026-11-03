/**
 * Edge tests for validateReading: whole-word quote guards, level labels and table mapping,
 * number words, stack and milestone limits, goal labels, and bounded refusal messages.
 */
import { describe, expect, it } from "vitest";
import levelMapFile from "../data/level-map.json";
import { validateReading, type IntakeModelOutput } from "../src/lib/intake";

const SYSTEMS = (levelMapFile as { levels: string[]; systems: Record<string, Record<string, string>> })
  .systems;

/** A model reading with nothing found, overridable per test. */
const reading = (overrides: Partial<IntakeModelOutput> = {}): IntakeModelOutput => ({
  roleFamily: null,
  level: null,
  company: null,
  title: null,
  yearsExperience: null,
  region: null,
  compBand: null,
  stack: [],
  milestones: [],
  goal: null,
  ...overrides,
});
const q = <T>(value: T, quote: string) => ({ value, quote });

describe("validateReading quote guard", () => {
  it("uses whole words: the quote 'go' does not ground 'I want to reach my goal'", () => {
    const v = validateReading(reading({ roleFamily: q("backend", "go") }), "I want to reach my goal");
    expect(v.draft.roleFamily).toBeUndefined();
    expect(v.discarded).toEqual(["roleFamily: the quoted words are not in what you wrote."]);
  });
});

describe("validateReading level labels", () => {
  it("accepts a lower-case label and upper-cases it", () => {
    const v = validateReading(reading({ level: q("l5", "i am l5") }), "i am l5");
    expect(v.discarded).toEqual([]);
    expect(v.draft.level).toBe("L5");
  });

  it("accepts EM1 and EM2", () => {
    expect(validateReading(reading({ level: q("EM1", "EM1") }), "I am EM1 now").draft.level).toBe("EM1");
    expect(validateReading(reading({ level: q("EM2", "EM2") }), "I am EM2 now").draft.level).toBe("EM2");
  });

  it("refuses 'l 5' and 'L05': the label must be on the ladder exactly", () => {
    expect(validateReading(reading({ level: q("l 5", "l 5") }), "level l 5 here").discarded[0]).toContain(
      "not on the level ladder",
    );
    expect(validateReading(reading({ level: q("L05", "L05") }), "L05 here").discarded[0]).toContain(
      "not on the level ladder",
    );
  });
});

describe("validateReading company and title mapping", () => {
  it("maps every title in the level table to the level the table says", () => {
    for (const [system, titles] of Object.entries(SYSTEMS)) {
      for (const [title, level] of Object.entries(titles)) {
        const text = `${title} at ${system}`;
        const v = validateReading(reading({ company: q(system, system), title: q(title, title) }), text);
        expect(v.discarded).toEqual([]);
        expect(v.draft.level).toBe(level);
        expect(v.provenance["level"]?.source).toBe("mapped");
      }
    }
  });

  it("ignores case and extra spaces in the company and title values", () => {
    const v = validateReading(
      reading({
        company: q("  bigtech a ", "BigTech A"),
        title: q("SENIOR SDE", "Senior SDE"),
      }),
      "Senior SDE at BigTech A",
    );
    expect(v.draft.level).toBe("L5");
    expect(v.provenance["level"]).toMatchObject({ source: "mapped", via: "BigTech A / Senior SDE" });
  });

  it("refuses a title that exists only in a different company's table", () => {
    // E5 is a BigTech B title; at BigTech A it means nothing the table knows.
    const v = validateReading(
      reading({ company: q("BigTech A", "BigTech A"), title: q("E5", "E5") }),
      "E5 at BigTech A",
    );
    expect(v.draft.level).toBeUndefined();
    expect(v.discarded[0]).toContain("cannot be mapped to a level without guessing");
  });

  it("maps the same title differently per company: Engineer is L3 at Series C Fintech, L4 at Growth Startup", () => {
    const fintech = validateReading(
      reading({
        company: q("Series C Fintech", "Series C Fintech"),
        title: q("Engineer", "Engineer"),
      }),
      "Engineer at Series C Fintech",
    );
    const startup = validateReading(
      reading({ company: q("Growth Startup", "Growth Startup"), title: q("Engineer", "Engineer") }),
      "Engineer at Growth Startup",
    );
    expect(fintech.draft.level).toBe("L3");
    expect(startup.draft.level).toBe("L4");
  });
});

describe("validateReading literal level versus mapping", () => {
  it("still maps company and title when the literal level is refused", () => {
    // The mapping branch runs whenever no literal level was accepted, so the draft ends up
    // with the mapped level alongside the refusal of the bad literal.
    const v = validateReading(
      reading({
        level: q("L9", "L9"),
        company: q("BigTech A", "BigTech A"),
        title: q("Senior SDE", "Senior SDE"),
      }),
      "L9 Senior SDE at BigTech A",
    );
    expect(v.draft.level).toBe("L5");
    expect(v.provenance["level"]?.source).toBe("mapped");
    expect(v.discarded).toHaveLength(1);
    expect(v.discarded[0]).toContain("not on the level ladder");
  });

  it("skips mapping when the literal level is accepted, so the literal wins", () => {
    // Principal at BigTech A would map to L6, but the stated L5 stands.
    const v = validateReading(
      reading({
        level: q("L5", "L5"),
        company: q("BigTech A", "BigTech A"),
        title: q("Principal", "Principal"),
      }),
      "L5 Principal at BigTech A",
    );
    expect(v.discarded).toEqual([]);
    expect(v.draft.level).toBe("L5");
    expect(v.provenance["level"]).toEqual({ source: "text", quote: "L5" });
  });
});

describe("validateReading years of experience", () => {
  it("accepts 0 and 40, the ends of the range", () => {
    expect(
      validateReading(reading({ yearsExperience: q(0, "0 years") }), "0 years exp").draft.yearsExperience,
    ).toBe(0);
    expect(
      validateReading(reading({ yearsExperience: q(40, "40 years") }), "40 years exp").draft.yearsExperience,
    ).toBe(40);
  });

  it("refuses 40.5 as out of range but accepts a fractional 2.5 years", () => {
    // The range check is `value > 40`, so 40.5 fails on range, not on being fractional:
    // 2.5 passes because numbersIn reads "2.5" back out of the quote.
    const over = validateReading(reading({ yearsExperience: q(40.5, "40.5 years") }), "40.5 years exp");
    expect(over.draft.yearsExperience).toBeUndefined();
    expect(over.discarded[0]).toContain("outside 0 to 40");
    expect(
      validateReading(reading({ yearsExperience: q(2.5, "2.5 years") }), "2.5 years exp").draft
        .yearsExperience,
    ).toBe(2.5);
  });

  it("refuses NaN and Infinity", () => {
    expect(validateReading(reading({ yearsExperience: q(NaN, "x") }), "x").discarded[0]).toContain(
      "outside 0 to 40",
    );
    expect(validateReading(reading({ yearsExperience: q(Infinity, "x") }), "x").discarded[0]).toContain(
      "outside 0 to 40",
    );
  });

  it("accepts 'twenty years' as 20", () => {
    expect(
      validateReading(reading({ yearsExperience: q(20, "twenty years") }), "twenty years exp").draft
        .yearsExperience,
    ).toBe(20);
  });

  it("reads compound number words: twenty-one, thirty five (review finding)", () => {
    const t = (value: number, quote: string) =>
      validateReading(reading({ yearsExperience: q(value, quote) }), `I have ${quote} years`).draft
        .yearsExperience;
    expect(t(21, "twenty-one")).toBe(21);
    expect(t(35, "thirty five")).toBe(35);
    expect(t(29, "Twenty-Nine")).toBe(29);
    expect(t(22, "twenty-one")).toBeUndefined(); // the value must be what the words say
    expect(t(1, "twenty-one")).toBeUndefined();
    expect(t(20, "twenty")).toBe(20);
  });
});

describe("validateReading region", () => {
  it("matches case-insensitively and returns the canonical spelling", () => {
    expect(validateReading(reading({ region: q("eu-west", "Dublin") }), "based in Dublin").draft.region).toBe(
      "EU-west",
    );
  });

  it("trims whitespace around the value", () => {
    expect(
      validateReading(reading({ region: q("  US-west  ", "Portland") }), "Portland office").draft.region,
    ).toBe("US-west");
  });

  it("refuses an empty string", () => {
    const v = validateReading(reading({ region: q("", "x") }), "x");
    expect(v.draft.region).toBeUndefined();
    expect(v.discarded[0]).toContain("not a region the data covers");
  });
});

describe("validateReading stack", () => {
  it("collapses duplicates in different case", () => {
    const v = validateReading(reading({ stack: ["Go", "GO", "go"] }), "I use go daily");
    expect(v.draft.stack).toEqual(["go"]);
  });

  it("keeps skills with '+', '#' and '.'", () => {
    const v = validateReading(reading({ stack: ["c++", "c#", "node.js"] }), "I use c++ and c# and node.js");
    expect(v.discarded).toEqual([]);
    expect(v.draft.stack).toEqual(["c++", "c#", "node.js"]);
  });

  it("refuses a numeric-only item: a skill has at least one letter (review finding)", () => {
    const v = validateReading(reading({ stack: ["123"] }), "my code is 123");
    expect(v.draft.stack).toEqual([]);
    expect(v.discarded[0]).toContain("not a recognisable skill name");
  });

  it("keeps exactly 15 when 16 are given", () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `s${i}`);
    const v = validateReading(reading({ stack: sixteen }), sixteen.join(" "));
    expect(v.draft.stack).toHaveLength(15);
    expect(v.draft.stack).toEqual(sixteen.slice(0, 15));
  });
});

describe("validateReading milestones", () => {
  it("keeps the first 20 of 21 grounded milestones", () => {
    const quotes = Array.from({ length: 21 }, (_, i) => `event ${i} in 2024`);
    const v = validateReading(
      reading({
        milestones: quotes.map((quote, i) => ({
          type: `event${i}`,
          quarter: `2024-Q${(i % 4) + 1}`,
          note: `note ${i}`,
          quote,
        })),
      }),
      quotes.join(". "),
    );
    expect(v.draft.milestones).toHaveLength(20);
  });

  it("keeps the same quarter twice when the milestones differ", () => {
    const v = validateReading(
      reading({
        milestones: [
          { type: "promotion", quarter: "2024-Q3", note: "Promoted", quote: "promoted in 2024" },
          { type: "launch", quarter: "2024-Q3", note: "Launched", quote: "launched in 2024" },
        ],
      }),
      "promoted in 2024 and launched in 2024",
    );
    expect(v.discarded).toEqual([]);
    expect(v.draft.milestones).toHaveLength(2);
  });

  it("refuses a quote naming a different year than the quarter", () => {
    const v = validateReading(
      reading({
        milestones: [{ type: "launch", quarter: "2021-Q2", note: "Shipped", quote: "shipped in 2020" }],
      }),
      "shipped in 2020",
    );
    expect(v.draft.milestones).toEqual([]);
    expect(v.discarded).toEqual(["milestones: the quote does not mention 2021."]);
  });
});

describe("validateReading goal", () => {
  it("trims a label longer than 60 characters to 60", () => {
    const v = validateReading(
      reading({ goal: { targetLevel: "L6", label: "x".repeat(70), quote: "Staff" } }),
      "want Staff role",
    );
    expect(v.draft.goal).toEqual({ targetLevel: "L6", label: "x".repeat(60) });
  });

  it("falls back to the level when the label is empty", () => {
    const v = validateReading(
      reading({ goal: { targetLevel: "L6", label: "   ", quote: "Staff" } }),
      "want Staff role",
    );
    expect(v.draft.goal).toEqual({ targetLevel: "L6", label: "L6" });
  });
});

describe("validateReading discarded messages", () => {
  it("never embed more than 30 characters of the model's raw value", () => {
    // Every slice call on a raw value caps at 30 (level 10, region 20, band 4, stack 30,
    // quarter 10, goal target 10), so a huge hostile string cannot flood the response.
    const hostile = (ch: string, n: number) => ch.repeat(n);
    const stack = validateReading(reading({ stack: [hostile("s", 200)] }), "nothing usable here");
    expect(stack.discarded[0]).toContain(hostile("s", 30));
    expect(stack.discarded[0]).not.toContain(hostile("s", 31));

    const region = validateReading(reading({ region: q(hostile("r", 100), "x") }), "x");
    expect(region.discarded[0]).toContain(hostile("r", 20));
    expect(region.discarded[0]).not.toContain(hostile("r", 21));

    const level = validateReading(reading({ level: q(hostile("l", 100), "x") }), "x");
    expect(level.discarded[0]).toContain(hostile("l", 10));
    expect(level.discarded[0]).not.toContain(hostile("l", 11));

    const band = validateReading(reading({ compBand: q(hostile("b", 8), "x") }), "x");
    expect(band.discarded[0]).toContain(hostile("b", 4));
    expect(band.discarded[0]).not.toContain(hostile("b", 5));

    const quarter = validateReading(
      reading({
        milestones: [{ type: "t", quarter: hostile("q", 30), note: "n", quote: "x" }],
      }),
      "x",
    );
    expect(quarter.discarded[0]).toContain(hostile("q", 10));
    expect(quarter.discarded[0]).not.toContain(hostile("q", 11));

    const goal = validateReading(
      reading({ goal: { targetLevel: hostile("g", 50), label: "x", quote: "x" } }),
      "x",
    );
    expect(goal.discarded[0]).toContain(hostile("g", 10));
    expect(goal.discarded[0]).not.toContain(hostile("g", 11));
  });
});

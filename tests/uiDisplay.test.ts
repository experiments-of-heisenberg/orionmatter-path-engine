/** Words, not codes: the display module and the pay-band table behind it. */
import { afterEach, describe, expect, it } from "vitest";
import payBands from "../data/pay-bands.json";
import {
  LEVEL_TITLE,
  bandWords,
  displayActive,
  floorLabel,
  h,
  humanize,
  levelTitle,
  payWords,
  setDisplayRegion,
} from "../src/ui/display";
import { GOAL_LABEL, REGION_OPTIONS } from "../src/ui/intake";

afterEach(() => setDisplayRegion(undefined));

/** The dollar figure keeps "about" and the number on one line with a no-break space; a reader sees an ordinary one. */
const plain = (text: string): string => text.replace(/\u00a0/g, " ");

describe("the pay table", () => {
  const regions = payBands.regions as Record<string, { currency: string; unit: string; cuts: number[] }>;
  it("covers every region the app knows, and only those", () => {
    expect(Object.keys(regions).sort()).toEqual([...REGION_OPTIONS].sort());
  });
  it("has four cut points per region that only go up, so five bands are ordered and never overlap", () => {
    for (const [name, spec] of Object.entries(regions)) {
      expect(spec.cuts, name).toHaveLength(4);
      for (let i = 1; i < spec.cuts.length; i++)
        expect(spec.cuts[i] as number, name).toBeGreaterThan(spec.cuts[i - 1] as number);
      expect(spec.cuts[0], name).toBeGreaterThan(0);
    }
  });
  it("says where its numbers come from and that the cohort has no salaries", () => {
    expect(payBands._note).toMatch(/synthetic cohort stores only the order/);
    expect(payBands._sources.length).toBeGreaterThanOrEqual(4);
  });
  it("uses a currency each region is paid in", () => {
    expect(regions["IN-south"]?.currency).toBe("INR");
    expect(regions["EU-west"]?.currency).toBe("EUR");
    expect(regions["US-east"]?.currency).toBe("USD");
  });
});

describe("level titles", () => {
  it("agree with the goal words the intake form already used", () => {
    expect(LEVEL_TITLE).toEqual(GOAL_LABEL);
  });
  it("name every level in the data, and pass an unknown label through", () => {
    for (const code of ["L3", "L4", "L5", "L6", "L7", "EM1", "EM2"]) expect(levelTitle(code)).not.toBe(code);
    expect(levelTitle("L9")).toBe("L9");
  });
});

describe("with no region set, nothing changes", () => {
  it("leaves every code as written, so isolated components and the engine's tests see what they always saw", () => {
    expect(displayActive()).toBe(false);
    expect(h("B4-B5 at L6, band B3 or higher")).toBe("B4-B5 at L6, band B3 or higher");
    expect(plain(bandWords(["B4", "B5"]))).toBe("B4\u2013B5");
    expect(plain(bandWords(["B5", "B5"]))).toBe("B5");
    expect(floorLabel(4)).toBe("B4");
  });
  it("a region the table does not know switches it off rather than guessing", () => {
    setDisplayRegion("MARS");
    expect(displayActive()).toBe(false);
  });
});

describe("in India", () => {
  it("turns bands into rupees with a dollar figure", () => {
    setDisplayRegion("IN-south");
    expect(plain(payWords(4, 4))).toBe("\u20b970 lakh to \u20b91.2 crore (about $85k to $140k)");
    expect(plain(payWords(5, 5))).toBe("\u20b91.2 crore or more (about $140k+)");
    expect(plain(payWords(1, 1))).toBe("under \u20b920 lakh (under about $25k)");
    expect(plain(bandWords(["B4", "B5"]))).toBe("\u20b970 lakh or more (about $85k+)");
    expect(plain(bandWords(["-", "-"]))).toBe("\u2014");
    expect(plain(bandWords(["B2", "-"]))).toBe("\u20b920 lakh to \u20b940 lakh (about $25k to $45k)");
  });
  it("floors read as a minimum, and the lowest floor is no floor", () => {
    setDisplayRegion("IN-south");
    expect([1, 2, 3, 4, 5].map(floorLabel)).toEqual([
      "Any pay",
      "\u20b920L+",
      "\u20b940L+",
      "\u20b970L+",
      "\u20b91.2 Cr+",
    ]);
    expect(plain(humanize("I need pay band B4 or higher"))).toBe(
      "I need a pay of at least \u20b970 lakh (about $85k+)",
    );
    expect(plain(humanize("band B1 or above"))).toBe("any pay");
  });
});

describe("a minimum is a floor, not a range", () => {
  it("rewrites the model's phrasings of a lowest pay", () => {
    setDisplayRegion("IN-south");
    expect(plain(humanize("After adding a B4 minimum, your climb route looks narrower"))).toBe(
      "After adding a minimum pay of \u20b970 lakh (about $85k+), your climb route looks narrower",
    );
    expect(plain(humanize("with a B3 pay floor"))).toBe("with a minimum pay of \u20b940 lakh (about $45k+)");
    expect(humanize("a B1 minimum")).toBe("no minimum pay");
  });
});

describe("elsewhere", () => {
  it("dollars need no second figure", () => {
    setDisplayRegion("US-west");
    expect(plain(humanize("B4 to B5"))).toBe("$350k or more");
    expect(plain(humanize("B3"))).toBe("$250k to $350k");
  });
  it("euros get a dollar figure", () => {
    setDisplayRegion("EU-west");
    expect(plain(humanize("B3"))).toBe("\u20ac80k to \u20ac110k (about $90k to $120k)");
  });
});

describe("humanize on sentences", () => {
  it("rewrites ranges, singles, floors and levels in one pass", () => {
    setDisplayRegion("US-east");
    expect(plain(humanize("Pay B4-B5 for L6; B3 or higher at L5; EM1 too"))).toBe(
      "Pay $350k or more for Staff Engineer; a pay of at least $250k at Senior Engineer; Engineering Manager too",
    );
  });
  it("drops a bracketed level the words before it already say", () => {
    setDisplayRegion("IN-south");
    expect(plain(humanize("a senior backend engineer (L5) with 7 years"))).toBe(
      "a senior backend engineer with 7 years",
    );
  });
  it("drops the key to the codes, which the words make unnecessary", () => {
    setDisplayRegion("IN-south");
    expect(plain(humanize("Which minimum pay band do you want? B1 is lowest, B5 highest."))).toBe(
      "Which minimum yearly pay do you want?",
    );
  });
  it("leaves evidence ids, sizes, ranges and look-alikes exactly as they are", () => {
    setDisplayRegion("IN-south");
    const same = [
      "n=53 and ev_b5a0e2c1 and 74\u201392%",
      "ABB4 and B45 and L35 and EMB1 and LB3",
      "findTwins: 150 comparable engineers",
      "Backend \u00b7 7 years \u00b7 South India",
    ];
    for (const text of same) expect(humanize(text), text).toBe(text);
  });
  it("is stable: running it twice gives what running it once gives", () => {
    setDisplayRegion("IN-south");
    const once = humanize("B4-B5 at L6, band B2 or higher (L5)");
    expect(humanize(once)).toBe(once);
  });
  it("never leaves a code behind in a long sentence of codes", () => {
    setDisplayRegion("SEA");
    const text = Array.from({ length: 5 }, (_, i) => `B${i + 1} L${i + 3}`).join(", ");
    expect(humanize(text)).not.toMatch(/\b(?:B[1-5]|L[3-7])\b/);
  });
});

/** Exact pay written in words ("4200000 rupees") is found by code, like pay written with a symbol or a unit. */
import { describe, expect, it } from "vitest";
import { detectIdentifiers } from "../src/lib/privacy";

const pay = (text: string) =>
  detectIdentifiers(text)
    .filter((f) => f.category === "exact_compensation")
    .map((f) => f.quote);

describe("pay in words", () => {
  it("finds an amount followed by a currency word", () => {
    expect(pay("I earned 4200000 rupees in 2023.")).toEqual(["4200000 rupees"]);
    expect(pay("They paid 85,000 dollars a year")).toEqual(["85,000 dollars"]);
    expect(pay("about 70000 euros")).toEqual(["70000 euros"]);
    expect(pay("Rs. 12,00,000 per year")).toEqual(["Rs. 12,00,000"]);
    expect(pay("INR 45000 a month")).toEqual(["INR 45000"]);
    expect(pay("12,00,000 Rs a year")).toEqual(["12,00,000 Rs"]);
    expect(pay("50000 pounds")).toEqual(["50000 pounds"]);
  });
  it("still finds the symbol and unit forms", () => {
    expect(pay("I make $120k and 30 LPA")).toHaveLength(2);
    expect(pay("₹45 lakh")).toHaveLength(1);
  });
  it("does not fire on ordinary words that merely start the same way", () => {
    expect(pay("I managed 3 rsync jobs and 5 pounding tasks")).toEqual([]);
    expect(pay("a 2023 roadmap with 4 dollarama stores")).toEqual([]);
    expect(pay("5 Rs-compatible tools")).toEqual(["5 Rs"]); // the abbreviation on its own is pay-shaped; code errs on the side of flagging
  });
});

/**
 * Tests for level ranking and its effect on twin matching. Regression coverage for a bug
 * found by Muse Code in Part 2: manager-track profiles (EM1/EM2) matched no engineers
 * because levels were compared by parsing digits out of the label.
 */
import { describe, expect, it } from "vitest";
import { findTwins } from "../src/lib/tools";
import { LEVEL_MAP } from "../src/lib/tools/data";
import { levelRank, RANKED_LEVELS } from "../src/lib/tools/levels";
import { Profile } from "../src/lib/schemas";

const base = { roleFamily: "backend", yearsExperience: 8, stack: ["go"], region: "IN-south" } as const;
const goal = { targetLevel: "L6", label: "Staff" };

describe("levelRank", () => {
  it("orders the IC track by level", () => {
    expect(levelRank("L3")).toBeLessThan(levelRank("L4") as number);
    expect(levelRank("L6")).toBeLessThan(levelRank("L7") as number);
  });

  it("ranks manager levels by seniority parity with the IC track, not by their digit", () => {
    expect(levelRank("EM1")).toBe(levelRank("L5"));
    expect(levelRank("EM2")).toBe(levelRank("L6"));
  });

  it("returns undefined for a label that is not on the ladder", () => {
    expect(levelRank("L99")).toBeUndefined();
    expect(levelRank("")).toBeUndefined();
  });

  it("has a rank for every level in the level map (guards against the two drifting apart)", () => {
    expect([...RANKED_LEVELS].sort()).toEqual([...LEVEL_MAP.levels].sort());
  });
});

describe("findTwins across tracks", () => {
  it("finds twins for a manager-track profile (regression: used to match nobody)", () => {
    const em1 = findTwins(Profile.parse({ ...base, level: "EM1" }), goal);
    expect(em1.n).toBeGreaterThan(0);
  });

  it("treats EM1 like L5 for matching purposes", () => {
    const asEm = findTwins(Profile.parse({ ...base, level: "EM1" }), goal);
    const asL5 = findTwins(Profile.parse({ ...base, level: "L5" }), goal);
    expect(asEm.twinIds).toEqual(asL5.twinIds);
  });

  it("matches nobody for a level that is not on the ladder, instead of guessing", () => {
    const result = findTwins(Profile.parse({ ...base, level: "L99" }), goal);
    expect(result).toEqual({ twinIds: [], n: 0 });
  });
});

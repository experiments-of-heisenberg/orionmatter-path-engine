/**
 * Edge tests for disclosureLadder: an exhaustive sweep (every role family, start level L3..L6,
 * goal and cohort region) checking the ladder never grows and matches kAnonymity rung by rung,
 * k at and beyond its extremes, drop-to-reach-k verified through kAnonymity, and unknown
 * company types, levels and goals.
 */
import { describe, expect, it } from "vitest";
import { disclosureLadder } from "../src/lib/privacy";
import { Goal, Profile, RoleFamily } from "../src/lib/schemas";
import { COHORT } from "../src/lib/tools/data";
import { kAnonymity, type AnonAttrs } from "../src/lib/tools/kAnonymity";
import { goal, profile } from "./helpers/fixturesData";

const REGIONS = [...new Set(COHORT.map((r) => r.region))];
const START_LEVELS: ReadonlySet<string> = new Set(COHORT.map((r) => r.startLevel));

/** Ladder's person-friendly attribute names back to cohort keys. */
const ADDED_TO_KEY: Record<string, keyof AnonAttrs> = {
  role: "roleFamily",
  level: "startLevel",
  goal: "endLevel",
  region: "region",
  "company type": "companyType",
};

describe("disclosureLadder exhaustive sweep", () => {
  it("never grows down the ladder and matches kAnonymity rung by rung, for every combination", () => {
    const levels = ["L3", "L4", "L5", "L6"];
    const goals = ["L6", "EM1"];
    let ladders = 0;
    for (const roleFamily of RoleFamily.options) {
      for (const level of levels) {
        for (const targetLevel of goals) {
          for (const region of REGIONS) {
            const p = Profile.parse({ roleFamily, level, yearsExperience: 7, stack: [], region });
            const g = Goal.parse({ targetLevel, label: "t" });
            const { rungs } = disclosureLadder({ profile: p, goal: g });
            ladders++;
            // The level rung exists exactly when the data can count that level.
            expect(rungs.some((r) => r.added === "level")).toBe(START_LEVELS.has(level));
            let attrs: AnonAttrs = {};
            for (const rung of rungs) {
              if (rung.added === "role") attrs = { ...attrs, roleFamily: p.roleFamily };
              else if (rung.added === "level")
                attrs = { ...attrs, startLevel: p.level as "L3" | "L4" | "L5" };
              else if (rung.added === "goal") attrs = { ...attrs, endLevel: g.targetLevel as "L6" | "EM1" };
              else if (rung.added === "region") attrs = { ...attrs, region: p.region };
              else throw new Error(`unexpected rung: ${rung.added}`);
              expect(rung.size).toBe(kAnonymity(attrs, COHORT, 10).groupSize);
            }
            for (let i = 1; i < rungs.length; i++) {
              expect(rungs[i]?.size).toBeLessThanOrEqual(rungs[i - 1]?.size ?? 0);
            }
          }
        }
      }
    }
    expect(ladders).toBe(RoleFamily.options.length * levels.length * goals.length * REGIONS.length);
    expect(ladders).toBeGreaterThan(0);
  });
});

describe("disclosureLadder k extremes", () => {
  it("k = 1: any non-empty crowd passes, and an empty one does not", () => {
    const result = disclosureLadder({ profile, goal, k: 1 });
    expect(result.rungs.map((r) => r.passes)).toEqual(result.rungs.map(() => true));
    expect(result.fullPasses).toBe(true);
    expect(result.dropToReachK).toEqual([]);
    const empty = disclosureLadder({ profile, goal, companyType: "spaceship", k: 1 });
    expect(empty.rungs.at(-1)).toMatchObject({ size: 0, passes: false });
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses k = %s, which is not a whole number of at least 1 (review finding)",
    (k) => {
      expect(() => disclosureLadder({ profile, goal, k })).toThrow(RangeError);
    },
  );

  it("k larger than the cohort: nothing passes and nothing is shareable", () => {
    const k = COHORT.length + 1;
    const result = disclosureLadder({ profile, goal, k });
    expect(result.rungs.map((r) => r.passes)).toEqual(result.rungs.map(() => false));
    expect(result.shareableUpTo).toBeNull();
    // Why no drop list can help: even the whole cohort is below k.
    expect(kAnonymity({}, COHORT, k).groupSize).toBeLessThan(k);
  });
});

describe("disclosureLadder dropToReachK", () => {
  it("is empty when the full ladder passes", () => {
    expect(disclosureLadder({ profile, goal }).dropToReachK).toEqual([]);
  });

  it("dropping the listed attributes in order really reaches a crowd of at least k", () => {
    const failing = disclosureLadder({ profile, goal, companyType: "robotics" });
    expect(failing.fullPasses).toBe(false);
    const rest: AnonAttrs = {
      roleFamily: profile.roleFamily,
      startLevel: profile.level as "L4" | "L5",
      endLevel: goal.targetLevel as "L6" | "EM1",
      region: profile.region,
      companyType: "robotics",
    };
    let size = kAnonymity(rest, COHORT, 10).groupSize;
    for (const name of failing.dropToReachK) {
      const key = ADDED_TO_KEY[name];
      if (key === undefined) throw new Error(`unknown drop name: ${name}`);
      delete rest[key];
      const grown = kAnonymity(rest, COHORT, 10).groupSize;
      expect(grown).toBeGreaterThanOrEqual(size); // fewer constraints can only grow the crowd
      size = grown;
    }
    expect(size).toBeGreaterThanOrEqual(10);
  });

  it("holds for every failing combination in the sweep", () => {
    let checked = 0;
    for (const roleFamily of RoleFamily.options) {
      for (const region of REGIONS) {
        const p = Profile.parse({ roleFamily, level: "L5", yearsExperience: 7, stack: [], region });
        for (const targetLevel of ["L6", "EM1"]) {
          const g = Goal.parse({ targetLevel, label: "t" });
          const result = disclosureLadder({ profile: p, goal: g });
          if (result.fullPasses) {
            expect(result.dropToReachK).toEqual([]);
            continue;
          }
          const rest: AnonAttrs = {
            roleFamily: p.roleFamily,
            startLevel: "L5",
            endLevel: targetLevel as "L6" | "EM1",
            region: p.region,
          };
          for (const name of result.dropToReachK) {
            const key = ADDED_TO_KEY[name];
            if (key === undefined) throw new Error(`unknown drop name: ${name}`);
            delete rest[key];
          }
          expect(kAnonymity(rest, COHORT, 10).groupSize).toBeGreaterThanOrEqual(10);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("disclosureLadder unknowns", () => {
  it('an unknown companyType ("spaceship") ends the ladder at size 0 and fails', () => {
    const result = disclosureLadder({ profile, goal, companyType: "spaceship" });
    expect(result.rungs.at(-1)).toMatchObject({ added: "company type", size: 0, passes: false });
    expect(result.fullPasses).toBe(false);
  });

  it("a companyType read from the cohort data is found", () => {
    const known = [...new Set(COHORT.flatMap((r) => r.companyTypeSteps))].at(0);
    if (known === undefined) throw new Error("the cohort has no company types");
    expect(COHORT.some((r) => r.companyTypeSteps.includes(known))).toBe(true);
    const result = disclosureLadder({ profile, goal, companyType: known });
    expect(result.rungs.at(-1)?.added).toBe("company type");
    expect(result.rungs.at(-1)?.size).toBe(
      kAnonymity(
        {
          roleFamily: profile.roleFamily,
          startLevel: profile.level as "L4" | "L5",
          endLevel: goal.targetLevel as "L6" | "EM1",
          region: profile.region,
          companyType: known,
        },
        COHORT,
        10,
      ).groupSize,
    );
  });

  it.each(["L3", "L7"])("level %s: a note appears, the level rung is absent, the rest compute", (level) => {
    const p = Profile.parse({ ...profile, level });
    const result = disclosureLadder({ profile: p, goal });
    expect(result.rungs.map((r) => r.added)).toEqual(["role", "goal", "region"]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain(`your level (${level}) cannot be counted exactly`);
    let attrs: AnonAttrs = {};
    for (const rung of result.rungs) {
      if (rung.added === "role") attrs = { ...attrs, roleFamily: p.roleFamily };
      else if (rung.added === "goal") attrs = { ...attrs, endLevel: goal.targetLevel as "L6" | "EM1" };
      else if (rung.added === "region") attrs = { ...attrs, region: p.region };
      else throw new Error(`unexpected rung: ${rung.added}`);
      expect(rung.size).toBe(kAnonymity(attrs, COHORT, 10).groupSize);
    }
  });

  it('an unknown goal level ("L99") gives size 0 at the goal rung (stated)', () => {
    const result = disclosureLadder({ profile, goal: Goal.parse({ targetLevel: "L99", label: "t" }) });
    const rung = result.rungs.find((r) => r.added === "goal");
    expect(rung?.size).toBe(0);
    expect(rung?.passes).toBe(false);
    // Every rung after it stays at zero: nothing can match an impossible goal.
    expect(result.rungs.find((r) => r.added === "region")?.size).toBe(0);
  });
});

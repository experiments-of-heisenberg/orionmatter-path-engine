// Edge-case tests for the deterministic data-layer tools. Deterministic and offline:
// every expectation is computed from the checked-in synthetic cohort.
import { describe, it, expect } from "vitest";
import { compBands, findTwins, kAnonymity, levelMap, pathStats } from "../src/lib/tools";
import { COHORT } from "../src/lib/tools/data";
import { percentile } from "../src/lib/tools/stats";
import { Profile } from "../src/lib/schemas";

const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go"],
  region: "IN-south",
});
const goal = { targetLevel: "L6", label: "Staff" };

const byId = new Map(COHORT.map((r) => [r.id, r] as const));

function twinRecord(id: string) {
  const rec = byId.get(id);
  if (!rec) throw new Error(`unknown twin id: ${id}`);
  return rec;
}

describe("pathStats edges", () => {
  it("empty twin set returns n = 0 and evidenceThin", () => {
    const s = pathStats([], "climb");
    expect(s.n).toBe(0);
    expect(s.evidenceThin).toBe(true);
    expect(s.reachedRate).toEqual([0, 0]);
  });

  it("unknown ids are ignored and duplicates count once", () => {
    const firstId = findTwins(profile, goal).twinIds[0];
    if (!firstId) throw new Error("expected at least one twin");
    const first = twinRecord(firstId);
    expect(pathStats(["no-such-id"], first.archetype).n).toBe(0);
    expect(pathStats([first.id, first.id], first.archetype).n).toBe(1);
  });

  it("reachedRate stays within [0, 1] with low <= high", () => {
    const twins = findTwins(profile, goal);
    for (const archetype of ["climb", "jump", "pivot"] as const) {
      const s = pathStats(twins.twinIds, archetype);
      expect(s.reachedRate[0]).toBeGreaterThanOrEqual(0);
      expect(s.reachedRate[1]).toBeLessThanOrEqual(1);
      expect(s.reachedRate[0]).toBeLessThanOrEqual(s.reachedRate[1]);
    }
  });

  it("months percentiles are ordered when n is large", () => {
    const allIds = COHORT.map((r) => r.id);
    for (const archetype of ["climb", "jump", "pivot"] as const) {
      const s = pathStats(allIds, archetype);
      expect(s.n).toBeGreaterThanOrEqual(15);
      expect(s.evidenceThin).toBe(false);
      expect(s.monthsP25).toBeLessThanOrEqual(s.monthsP50);
      expect(s.monthsP50).toBeLessThanOrEqual(s.monthsP75);
    }
  });
});

describe("findTwins edges", () => {
  it("matches start levels within one and excludes two away", () => {
    // L5 profile: L4 and L5 starts match (one away or the same level).
    const l5 = findTwins(profile, goal);
    const starts = new Set(l5.twinIds.map((id) => twinRecord(id).startLevel));
    expect(starts.has("L4")).toBe(true);
    expect(starts.has("L5")).toBe(true);
    expect(starts.has("L3")).toBe(false);

    // L3 profile: L5 starts are two away and never match.
    const l3 = Profile.parse({ ...profile, level: "L3" });
    const l3Twins = findTwins(l3, goal);
    expect(l3Twins.n).toBeGreaterThan(0);
    for (const id of l3Twins.twinIds) {
      expect(twinRecord(id).startLevel).not.toBe("L5");
    }
  });

  it("remote constraint only returns remote engineers", () => {
    const t = findTwins(profile, goal, { remote: true });
    expect(t.n).toBeGreaterThan(0);
    for (const id of t.twinIds) {
      expect(twinRecord(id).remote).toBe(true);
    }
  });

  it("n always equals twinIds.length", () => {
    for (const constraints of [{}, { remote: true }, { noRelocation: true }]) {
      const t = findTwins(profile, goal, constraints);
      expect(t.n).toBe(t.twinIds.length);
    }
  });
});

describe("compBands edges", () => {
  it("unknown region returns n = 0 with null bands and evidenceThin", () => {
    const b = compBands("L6", "XX-nowhere");
    expect(b.n).toBe(0);
    expect(b.p25).toBeNull();
    expect(b.p50).toBeNull();
    expect(b.p75).toBeNull();
    expect(b.evidenceThin).toBe(true);
  });
});

describe("levelMap edges", () => {
  it("unknown company returns null", () => {
    expect(levelMap("No Such Company", "SDE II").canonicalLevel).toBeNull();
  });

  it("unknown title returns null", () => {
    expect(levelMap("BigTech A", "No Such Title").canonicalLevel).toBeNull();
  });
});

describe("kAnonymity edges", () => {
  it("empty attrs match the whole cohort and pass", () => {
    const r = kAnonymity({});
    expect(r.groupSize).toBe(COHORT.length);
    expect(r.passes).toBe(true);
    expect(r.offendingAttrs).toEqual([]);
  });

  it("k = 1 passes for a non-empty match with no offending attrs", () => {
    const r = kAnonymity({ roleFamily: "backend" }, COHORT, 1);
    expect(r.groupSize).toBeGreaterThan(0);
    expect(r.passes).toBe(true);
    expect(r.offendingAttrs).toEqual([]);
  });

  it("respects a custom small cohort passed as the second argument", () => {
    const small = COHORT.slice(0, 3);
    expect(kAnonymity({}, small).groupSize).toBe(3);
    expect(kAnonymity({}, small).passes).toBe(false);
    expect(kAnonymity({}, small, 3).passes).toBe(true);
  });
});

describe("percentile edges", () => {
  it("one element returns that element", () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([7], 1)).toBe(7);
  });

  it("two elements interpolate", () => {
    expect(percentile([2, 4], 0)).toBe(2);
    expect(percentile([2, 4], 0.25)).toBe(2.5);
    expect(percentile([2, 4], 0.5)).toBe(3);
    expect(percentile([2, 4], 1)).toBe(4);
  });

  it("empty array returns NaN", () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});

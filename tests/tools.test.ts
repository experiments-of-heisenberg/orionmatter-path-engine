import { describe, it, expect } from "vitest";
import { findTwins, pathStats, levelMap, compBands, kAnonymity, EvidenceLedger } from "../src/lib/tools";
import { COHORT } from "../src/lib/tools/data";
import { Profile } from "../src/lib/schemas";

const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go"],
  region: "IN-south",
});
const goal = { targetLevel: "L6", label: "Staff" };

describe("cohort", () => {
  it("is labeled synthetic and has failures", () => {
    expect(COHORT.every((r) => r.synthetic === true)).toBe(true);
    const f = COHORT.filter((r) => r.outcome !== "reached").length / COHORT.length;
    expect(f).toBeGreaterThan(0.2);
    expect(f).toBeLessThan(0.4);
  });
});
describe("tools", () => {
  it("findTwins returns ids and n", () => {
    const t = findTwins(profile, goal);
    expect(t.n).toBe(t.twinIds.length);
    expect(t.n).toBeGreaterThan(20);
  });
  it("pathStats returns ranges, never a single number", () => {
    const t = findTwins(profile, goal);
    const s = pathStats(t.twinIds, "jump");
    expect(s.reachedRate[0]).toBeLessThanOrEqual(s.reachedRate[1]);
    expect(s.monthsP25).not.toBeNull();
    expect(s.monthsP25 as number).toBeLessThanOrEqual(s.monthsP75 as number);
  });
  it("flags thin segments (n<15) as evidenceThin", () => {
    const ml = Profile.parse({ ...profile, roleFamily: "ml" });
    const t = findTwins(ml, goal);
    const s = pathStats(t.twinIds, "pivot");
    expect(s.n).toBeLessThan(15);
    expect(s.evidenceThin).toBe(true);
  });
  it("noRelocation constraint shrinks or equals twin set", () => {
    expect(findTwins(profile, goal, { noRelocation: true }).n).toBeLessThanOrEqual(
      findTwins(profile, goal).n,
    );
  });
  it("levelMap maps cross-company titles", () => {
    expect(levelMap("BigTech A", "SDE II").canonicalLevel).toBe("L4");
    expect(levelMap("Growth Startup", "Staff").canonicalLevel).toBe("L6");
    expect(levelMap("Nope", "X").canonicalLevel).toBeNull();
  });
  it("compBands returns bands not points", () => {
    const b = compBands("L6", "US-west");
    expect(b.n).toBeGreaterThan(0);
    expect(b.p25).toMatch(/^B\d$/);
  });
  it("kAnonymity passes a common tuple and flags a unique one", () => {
    expect(kAnonymity({ roleFamily: "backend", endLevel: "L6" }).passes).toBe(true);
    const u = kAnonymity({
      roleFamily: "embedded",
      endLevel: "L6",
      region: "SEA",
      startLevel: "L4",
      companyType: "robotics",
    });
    expect(u.passes).toBe(false);
    expect(u.groupSize).toBeLessThan(10);
    expect(u.offendingAttrs.length).toBeGreaterThan(0);
  });
  it("ledger gives unique evidence ids", () => {
    const ledger = new EvidenceLedger();
    const a = ledger.call("findTwins", { profile, goal });
    const b = ledger.call("findTwins", { profile, goal });
    expect(a.evidenceId).not.toBe(b.evidenceId);
    expect(ledger.all()).toHaveLength(2);
  });
});

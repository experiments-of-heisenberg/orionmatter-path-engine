/**
 * Edge tests for skillStats: empty and tiny twin sets, id handling, null medians, the
 * skill-name matcher and the cohort skill list. The main behaviour (known vs unknown,
 * distinguishable on non-overlap, limits) is covered in limitsAndRanking.test.ts; these
 * are the corners a small or odd input can reach.
 */
import { describe, expect, it } from "vitest";
import { findTwins, matchCohortSkill, skillStats, COHORT_SKILLS } from "../src/lib/tools";
import { COHORT } from "../src/lib/tools/data";
import { goal, profile } from "./helpers/fixturesData";

const twinIds = findTwins(profile, goal).twinIds;

describe("skillStats edge inputs", () => {
  it("with no twins, a known skill gives two empty groups that cannot be told apart", () => {
    const stats = skillStats([], "climb", "rust");
    expect(stats.known).toBe(true);
    expect(stats.withSkill.n).toBe(0);
    expect(stats.withoutSkill.n).toBe(0);
    expect(stats.distinguishable).toBe(false);
    expect(stats.evidenceThin).toBe(true);
  });

  it("counts duplicate twin ids once and ignores unknown ids", () => {
    const sample = twinIds.slice(0, 10);
    const single = skillStats(sample, "climb", "rust");
    const messy = skillStats([...sample, ...sample, "no-such-id", "syn_999999"], "climb", "rust");
    expect(messy.withSkill.n).toBe(single.withSkill.n);
    expect(messy.withoutSkill.n).toBe(single.withoutSkill.n);
    expect(messy.withSkill.reachedN).toBe(single.withSkill.reachedN);
    expect(messy.withoutSkill.reachedN).toBe(single.withoutSkill.reachedN);
  });

  it("when everyone in a tiny set proved the skill, the without group is empty", () => {
    // Three real climb twins who all proved rust, found in the cohort data itself.
    const ids = COHORT.filter((r) => r.archetype === "climb" && r.skillsProven.includes("rust"))
      .slice(0, 3)
      .map((r) => r.id);
    expect(ids).toHaveLength(3);
    const stats = skillStats(ids, "climb", "rust");
    expect(stats.known).toBe(true);
    expect(stats.withSkill.n).toBe(3);
    expect(stats.withoutSkill.n).toBe(0);
    expect(stats.distinguishable).toBe(false);
  });

  it("monthsP50 is null for a group where nobody reached the goal", () => {
    // A 12-month limit is below every climb twin's time, so neither group reached it.
    const stats = skillStats(twinIds, "climb", "rust", { maxMonths: 12 });
    expect(stats.withSkill.reachedN).toBe(0);
    expect(stats.withoutSkill.reachedN).toBe(0);
    expect(stats.withSkill.monthsP50).toBeNull();
    expect(stats.withoutSkill.monthsP50).toBeNull();
  });
});

describe("matchCohortSkill", () => {
  // Every alias key readable in the ALIASES table in src/lib/tools/skillStats.ts.
  const aliases: [string, string][] = [
    ["k8s", "kubernetes"],
    ["mlops", "ml-ops"],
    ["ml ops", "ml-ops"],
    ["system design", "system-design"],
    ["systems design", "system-design"],
    ["distributed systems", "distributed-systems"],
    ["cross team lead", "cross-team-lead"],
    ["cross-team leadership", "cross-team-lead"],
    ["cross team leadership", "cross-team-lead"],
    ["tech lead", "cross-team-lead"],
  ];

  it("resolves every alias to a skill the cohort records", () => {
    expect(aliases.length).toBeGreaterThan(0);
    for (const [alias, expected] of aliases) {
      expect(matchCohortSkill(alias), alias).toBe(expected);
      expect(COHORT_SKILLS.includes(expected), expected).toBe(true);
    }
  });

  it("ignores case and extra or trailing spaces", () => {
    expect(matchCohortSkill("RUST")).toBe("rust");
    expect(matchCohortSkill("K8S")).toBe("kubernetes");
    expect(matchCohortSkill("  rust  ")).toBe("rust");
    expect(matchCohortSkill("system  design")).toBe("system-design");
    expect(matchCohortSkill("SYSTEM DESIGN")).toBe("system-design");
  });

  it("returns undefined for the empty string and for spaces only", () => {
    expect(matchCohortSkill("")).toBeUndefined();
    expect(matchCohortSkill("   ")).toBeUndefined();
  });

  it('resolves both "system design" and "system-design"', () => {
    expect(matchCohortSkill("system design")).toBe("system-design");
    expect(matchCohortSkill("system-design")).toBe("system-design");
  });
});

describe("COHORT_SKILLS", () => {
  it("is sorted, unique and non-empty", () => {
    expect(COHORT_SKILLS.length).toBeGreaterThan(0);
    expect([...COHORT_SKILLS].sort()).toEqual([...COHORT_SKILLS]);
    expect(new Set(COHORT_SKILLS).size).toBe(COHORT_SKILLS.length);
  });
});

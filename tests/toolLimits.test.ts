/**
 * Tests for limit validation and the ledger around it: what LimitsSchema accepts, what the
 * skillStats arguments allow, that limits are recorded in the ledger, and how skillStats
 * results are summarized for the trace. This is the boundary where model-supplied numbers
 * become evidence, so every rejection here must be loud, never a silent clamp.
 */
import { describe, expect, it } from "vitest";
import { summarizeEvidence } from "../src/lib/engine";
import { EvidenceLedger, findTwins } from "../src/lib/tools";
import { LimitsSchema, ToolArgSchemas } from "../src/lib/tools/toolSchemas";
import { goal, profile } from "./helpers/fixturesData";

const twinIds = findTwins(profile, goal).twinIds;

describe("LimitsSchema", () => {
  it("accepts integers 1 to 240 for maxMonths", () => {
    expect(LimitsSchema.safeParse({ maxMonths: 1 }).success).toBe(true);
    expect(LimitsSchema.safeParse({ maxMonths: 24 }).success).toBe(true);
    expect(LimitsSchema.safeParse({ maxMonths: 240 }).success).toBe(true);
  });

  it("rejects 0, 241, 1.5 and strings for maxMonths", () => {
    expect(LimitsSchema.safeParse({ maxMonths: 0 }).success).toBe(false);
    expect(LimitsSchema.safeParse({ maxMonths: 241 }).success).toBe(false);
    expect(LimitsSchema.safeParse({ maxMonths: 1.5 }).success).toBe(false);
    expect(LimitsSchema.safeParse({ maxMonths: "24" }).success).toBe(false);
  });

  it("accepts B1 to B5 for minCompBand", () => {
    for (const band of ["B1", "B2", "B3", "B4", "B5"]) {
      expect(LimitsSchema.safeParse({ minCompBand: band }).success, band).toBe(true);
    }
  });

  it('rejects "B6", "b3" and numbers for minCompBand', () => {
    expect(LimitsSchema.safeParse({ minCompBand: "B6" }).success).toBe(false);
    expect(LimitsSchema.safeParse({ minCompBand: "b3" }).success).toBe(false);
    expect(LimitsSchema.safeParse({ minCompBand: 3 }).success).toBe(false);
  });

  it("accepts an empty object (no limits)", () => {
    expect(LimitsSchema.safeParse({})).toMatchObject({ success: true, data: {} });
  });

  it("strips unknown keys instead of rejecting them", () => {
    // Zod's default for z.object is to strip keys it does not know: the call succeeds
    // and the extra key is dropped, so a model that adds commentary cannot smuggle it in.
    const parsed = LimitsSchema.safeParse({ maxMonths: 24, favoriteColor: "blue" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ maxMonths: 24 });
  });
});

describe("ToolArgSchemas.skillStats", () => {
  const base = { twinIds: [] as string[], archetype: "climb" as const };

  it("requires skill to be 1 to 40 characters", () => {
    expect(ToolArgSchemas.skillStats.safeParse({ ...base, skill: "" }).success).toBe(false);
    expect(ToolArgSchemas.skillStats.safeParse({ ...base, skill: "r" }).success).toBe(true);
    expect(ToolArgSchemas.skillStats.safeParse({ ...base, skill: "a".repeat(40) }).success).toBe(true);
    expect(ToolArgSchemas.skillStats.safeParse({ ...base, skill: "a".repeat(41) }).success).toBe(false);
  });

  it("caps twinIds at 2000", () => {
    const ok = { ...base, skill: "rust", twinIds: Array<string>(2000).fill("syn_0001") };
    const tooMany = { ...base, skill: "rust", twinIds: Array<string>(2001).fill("syn_0001") };
    expect(ToolArgSchemas.skillStats.safeParse(ok).success).toBe(true);
    expect(ToolArgSchemas.skillStats.safeParse(tooMany).success).toBe(false);
  });

  it("validates the archetype", () => {
    expect(
      ToolArgSchemas.skillStats.safeParse({ twinIds: [], archetype: "jump", skill: "rust" }).success,
    ).toBe(true);
    expect(
      ToolArgSchemas.skillStats.safeParse({ twinIds: [], archetype: "swim", skill: "rust" }).success,
    ).toBe(false);
  });
});

describe("ledger and limits", () => {
  it("records pathStats and skillStats calls with limits in args", () => {
    const ledger = new EvidenceLedger();
    const path = ledger.call("pathStats", {
      twinIds,
      archetype: "climb",
      limits: { maxMonths: 24 },
    });
    expect(path.args.limits).toEqual({ maxMonths: 24 });
    expect(path.result.limits).toEqual({ maxMonths: 24 });
    const skill = ledger.call("skillStats", {
      twinIds,
      archetype: "climb",
      skill: "rust",
      limits: { minCompBand: "B4" },
    });
    expect(skill.args.limits).toEqual({ minCompBand: "B4" });
    expect(ledger.all()).toHaveLength(2);
  });

  it('callUntrusted rejects bad limits with a message starting "Invalid arguments for"', () => {
    const ledger = new EvidenceLedger();
    const badMonths = ledger.callUntrusted("pathStats", {
      twinIds,
      archetype: "climb",
      limits: { maxMonths: 0 },
    });
    expect(badMonths.ok).toBe(false);
    if (!badMonths.ok) expect(badMonths.error.startsWith("Invalid arguments for")).toBe(true);
    const badBand = ledger.callUntrusted("skillStats", {
      twinIds,
      archetype: "climb",
      skill: "rust",
      limits: { minCompBand: "B6" },
    });
    expect(badBand.ok).toBe(false);
    if (!badBand.ok) expect(badBand.error.startsWith("Invalid arguments for")).toBe(true);
  });
});

describe("summarizeEvidence for skillStats", () => {
  it("names both groups' n, and says (limited evidence) only when thin", () => {
    const ledger = new EvidenceLedger();
    // Pivot rust is thin (7 with the skill); jump rust is not (24 vs 41).
    const thin = ledger.call("skillStats", { twinIds, archetype: "pivot", skill: "rust" });
    const thinText = summarizeEvidence(thin);
    expect(thinText).toContain(`n=${thin.result.withSkill.n}`);
    expect(thinText).toContain(`n=${thin.result.withoutSkill.n}`);
    expect(thin.result.evidenceThin).toBe(true);
    expect(thinText).toContain("(limited evidence)");
    const solid = ledger.call("skillStats", { twinIds, archetype: "jump", skill: "rust" });
    const solidText = summarizeEvidence(solid);
    expect(solidText).toContain(`n=${solid.result.withSkill.n}`);
    expect(solidText).toContain(`n=${solid.result.withoutSkill.n}`);
    expect(solid.result.evidenceThin).toBe(false);
    expect(solidText).not.toContain("(limited evidence)");
  });

  it("says there is no cohort evidence for an unknown skill", () => {
    const ledger = new EvidenceLedger();
    const unknown = ledger.call("skillStats", { twinIds, archetype: "jump", skill: "go" });
    expect(unknown.result.known).toBe(false);
    expect(summarizeEvidence(unknown)).toContain("no cohort evidence");
  });
});

// The verifier's sampleSize helper is not exported, and verifyPlan never accepts a
// skillStats evidence id (a claim may only cite its route's pathStats, compBands and
// twin-set ids, so a skillStats citation is rejected as wrong_route_evidence before any
// sample-size check runs). There is therefore no indirect path that exercises the
// skillStats branch (withSkill.n + withoutSkill.n), so it is not tested here.
describe.skip("verifier sampleSize for skillStats", () => {
  it("is not reachable through verifyPlan", () => {
    expect(true).toBe(true);
  });
});

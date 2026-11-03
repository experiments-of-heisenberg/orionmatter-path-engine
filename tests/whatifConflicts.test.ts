/** Tests for evidence-based conflicts: constraints that are valid but leave the person no good route. */
import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../src/lib/engine";
import { Constraints, Profile } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { evidenceConflicts } from "../src/lib/whatif";
import { input } from "./helpers/fixturesData";

const sheetFor = (constraints: Constraints, engineInput = input) =>
  gatherEvidence(new EvidenceLedger(), { ...engineInput, constraints });

describe("evidenceConflicts", () => {
  it("reports nothing for the default constraints on a well-supported plan", () => {
    const constraints = Constraints.parse({});
    expect(evidenceConflicts(sheetFor(constraints), constraints)).toEqual([]);
  });

  it("flags a time limit that nobody met, naming what the cohort did without it", () => {
    const constraints = Constraints.parse({ maxMonths: 6 });
    const sheet = sheetFor(constraints);
    const [conflict] = evidenceConflicts(sheet, constraints);
    expect(conflict).toMatchObject({ kind: "infeasible", fields: ["maxMonths"] });
    expect(conflict?.message).toContain("within 6 months");
    // Without the limit the fastest comparable engineer took 14 months, and up to 85% of a route reached the goal.
    expect(conflict?.message).toContain("the fastest took 14 months");
    expect(conflict?.message).toContain("up to 85%");
  });

  it("does not flag a time limit that at least one comparable engineer met", () => {
    const constraints = Constraints.parse({ maxMonths: 120 });
    expect(evidenceConflicts(sheetFor(constraints), constraints)).toEqual([]);
  });

  it("uses an inclusive boundary: finishing in exactly the limit counts as meeting it", () => {
    const fastest = 14; // the quickest comparable engineer in the sample data
    const exact = Constraints.parse({ maxMonths: fastest });
    expect(evidenceConflicts(sheetFor(exact), exact)).toEqual([]);
    const tighter = Constraints.parse({ maxMonths: fastest - 1 });
    expect(evidenceConflicts(sheetFor(tighter), tighter).some((c) => c.fields.includes("maxMonths"))).toBe(
      true,
    );
  });

  it("flags a pay floor nobody reached, naming the highest band that was reached", () => {
    const constraints = Constraints.parse({ minCompBand: "B4" });
    const sheet = structuredClone(sheetFor(constraints));
    for (const route of sheet.routes) {
      route.stats.reachedN = 0;
      route.stats.ignoringLimits.highestBand = "B2";
    }
    const [conflict] = evidenceConflicts(sheet, constraints);
    expect(conflict).toMatchObject({ kind: "infeasible", fields: ["minCompBand"] });
    expect(conflict?.message).toContain("pay band B4 or above");
    expect(conflict?.message).toContain("highest pay band any reached was B2");
  });

  it("does not flag a pay floor that some comparable engineers reached", () => {
    const constraints = Constraints.parse({ minCompBand: "B1" });
    expect(evidenceConflicts(sheetFor(constraints), constraints)).toEqual([]);
  });

  it("flags 'no comparable engineers' when nobody matches, and names the narrowing constraints", () => {
    const constraints = Constraints.parse({ remote: true, noRelocation: true });
    const empty = { ...input, goal: { targetLevel: "EM2", label: "Director" } };
    const [conflict] = evidenceConflicts(sheetFor(constraints, empty), constraints);
    expect(conflict).toMatchObject({ kind: "infeasible", fields: ["remote", "noRelocation"] });
    expect(conflict?.message).toContain("No comparable engineers");
  });

  it("warns of thin evidence when constraints leave fewer than 15 comparable engineers", () => {
    // An embedded engineer has 32 comparable twins; going remote-only halves that to 14.
    const embedded = { ...input, profile: Profile.parse({ ...input.profile, roleFamily: "embedded" }) };
    expect(sheetFor(Constraints.parse({}), embedded).twins.n).toBe(32);
    const constraints = Constraints.parse({ remote: true });
    const sheet = sheetFor(constraints, embedded);
    const [conflict] = evidenceConflicts(sheet, constraints);
    expect(sheet.twins.n).toBe(14);
    expect(conflict).toMatchObject({ kind: "thin_evidence", fields: ["remote"] });
    expect(conflict?.message).toContain("Only 14 comparable engineers");
  });

  it("names both limits in ONE conflict when neither can be met together", () => {
    const constraints = Constraints.parse({ maxMonths: 6, minCompBand: "B5" });
    const conflicts = evidenceConflicts(sheetFor(constraints), constraints);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.fields).toEqual(["maxMonths", "minCompBand"]);
    expect(conflicts[0]?.message).toContain("within 6 months and at pay band B5 or above");
  });

  it("can report a thin cohort together with an unmet limit", () => {
    const embedded = { ...input, profile: Profile.parse({ ...input.profile, roleFamily: "embedded" }) };
    const constraints = Constraints.parse({ remote: true, maxMonths: 6 });
    const kinds = evidenceConflicts(sheetFor(constraints, embedded), constraints).map((c) => c.kind);
    expect(kinds).toEqual(["thin_evidence", "infeasible"]);
  });

  it("does not report an unmet limit when nobody reached the goal at all (that has its own message)", () => {
    const constraints = Constraints.parse({ maxMonths: 6 });
    const sheet = structuredClone(sheetFor(constraints));
    for (const route of sheet.routes) route.stats.ignoringLimits.reachedShare = 0;
    const messages = evidenceConflicts(sheet, constraints).map((c) => c.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("None of the 150 comparable engineers reached this goal, so no route");
  });
});

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

  it("flags a time limit shorter than any route's typical timeline, naming the fastest route and its range", () => {
    const constraints = Constraints.parse({ maxMonths: 6 });
    const sheet = sheetFor(constraints);
    const fastest = sheet.routes
      .filter((r) => r.monthsToGoal)
      .sort((a, b) => a.monthsToGoal![0] - b.monthsToGoal![0])[0]!;
    const [conflict] = evidenceConflicts(sheet, constraints);
    expect(conflict).toMatchObject({ kind: "infeasible", fields: ["maxMonths"] });
    expect(conflict?.message).toContain("6 months");
    expect(conflict?.message).toContain(`${fastest.monthsToGoal![0]} to ${fastest.monthsToGoal![1]} months`);
    expect(conflict?.message).toContain(fastest.archetype);
  });

  it("does not flag a time limit that at least one route's typical timeline fits", () => {
    const constraints = Constraints.parse({ maxMonths: 120 });
    expect(evidenceConflicts(sheetFor(constraints), constraints)).toEqual([]);
  });

  it("uses a strict boundary: a limit equal to the fastest typical start is not a conflict", () => {
    const probe = sheetFor(Constraints.parse({}));
    const fastestStart = Math.min(
      ...probe.routes.flatMap((r) => (r.monthsToGoal ? [r.monthsToGoal[0]] : [])),
    );
    const constraints = Constraints.parse({ maxMonths: fastestStart });
    expect(evidenceConflicts(sheetFor(constraints), constraints)).toEqual([]);
    const tighter = Constraints.parse({ maxMonths: fastestStart - 1 });
    expect(evidenceConflicts(sheetFor(tighter), tighter).some((c) => c.fields.includes("maxMonths"))).toBe(
      true,
    );
  });

  it("flags a pay floor above every route's comp range, naming the highest band reached", () => {
    const constraints = Constraints.parse({ minCompBand: "B4" });
    const sheet = structuredClone(sheetFor(constraints));
    for (const route of sheet.routes) route.compBandRange = ["B1", "B2"];
    const [conflict] = evidenceConflicts(sheet, constraints);
    expect(conflict).toMatchObject({ kind: "infeasible", fields: ["minCompBand"] });
    expect(conflict?.message).toContain("B4");
    expect(conflict?.message).toContain("B2");
  });

  it("does not flag a pay floor that some route reaches", () => {
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

  it("can report several conflicts at once", () => {
    const constraints = Constraints.parse({
      maxMonths: 6,
      minCompBand: "B5",
      remote: true,
      noRelocation: true,
    });
    const sheet = structuredClone(sheetFor(constraints));
    for (const route of sheet.routes) route.compBandRange = ["B1", "B3"];
    const fields = evidenceConflicts(sheet, constraints).flatMap((c) => c.fields);
    expect(fields).toEqual(expect.arrayContaining(["maxMonths", "minCompBand"]));
  });
});

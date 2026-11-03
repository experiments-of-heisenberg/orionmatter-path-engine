/**
 * Edge tests for diffSheets: identity, symmetry, empty routes, thin transitions, band
 * formatting, evidence coverage, must-mention flags and determinism. The main reporting
 * behaviour (what a 24-month limit says, thresholds, grounding of numbers) lives in
 * whatifDiff.test.ts; these are the structural guarantees around it.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../src/lib/engine";
import { Constraints, Profile } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { diffSheets } from "../src/lib/whatif";
import { input } from "./helpers/fixturesData";

const sheetFor = (constraints: object) =>
  gatherEvidence(new EvidenceLedger(), { ...input, constraints: Constraints.parse(constraints) });

/** Diff two constraint sets, each computed on its own ledger (evidence ids differ, shapes do not). */
const diffFor = (from: object, to: object) => diffSheets(sheetFor(from), sheetFor(to));

describe("diffSheets edges", () => {
  it("diffing a sheet with itself is unchanged with no facts", () => {
    const sheet = sheetFor({});
    const d = diffSheets(sheet, sheet);
    expect(d.unchanged).toBe(true);
    expect(d.facts).toEqual([]);
    expect(d.routes.map((r) => r.status)).toEqual(["unchanged", "unchanged", "unchanged"]);
  });

  it("is symmetric: a route that disappears one way appears the other way", () => {
    const forward = diffFor({}, { maxMonths: 24 });
    const backward = diffFor({ maxMonths: 24 }, {});
    const disappeared = (d: typeof forward) =>
      d.facts.filter((f) => f.kind === "route_disappeared").map((f) => f.archetype);
    const appeared = (d: typeof forward) =>
      d.facts.filter((f) => f.kind === "route_appeared").map((f) => f.archetype);
    expect(disappeared(forward).sort()).toEqual(appeared(backward).sort());
    expect(appeared(forward).sort()).toEqual(disappeared(backward).sort());
    expect(disappeared(forward).length).toBeGreaterThan(0);
  });

  it("a route with n = 0 on both sides is unchanged and produces no facts", () => {
    // EM2 as a target matches nobody, so every route has n = 0 on both sides.
    const empty = { ...input, goal: { targetLevel: "EM2", label: "Director" } };
    const sheet = gatherEvidence(new EvidenceLedger(), {
      ...empty,
      constraints: Constraints.parse({}),
    });
    expect(sheet.twins.n).toBe(0);
    expect(sheet.routes.every((r) => r.n === 0)).toBe(true);
    const d = diffSheets(sheet, sheet);
    expect(d.unchanged).toBe(true);
    expect(d.facts).toEqual([]);
    expect(d.routes.every((r) => r.status === "unchanged")).toBe(true);
  });

  it("thin facts always say so, including across a thin-to-thinner transition", () => {
    // Embedded engineers go from 32 twins to 14 when filtered to remote-only.
    const embedded = { ...input, profile: Profile.parse({ ...input.profile, roleFamily: "embedded" }) };
    const before = gatherEvidence(new EvidenceLedger(), {
      ...embedded,
      constraints: Constraints.parse({}),
    });
    const after = gatherEvidence(new EvidenceLedger(), {
      ...embedded,
      constraints: Constraints.parse({ remote: true }),
    });
    expect(before.twins.n).toBeGreaterThanOrEqual(15);
    expect(after.twins.n).toBeLessThan(15);
    const d = diffSheets(before, after);
    expect(d.facts.length).toBeGreaterThan(0);
    // Every thin fact, including pay-band facts, must say "limited evidence" in its own text.
    const thinNonComp = d.facts.filter((f) => f.thin);
    expect(thinNonComp.length).toBeGreaterThan(0);
    for (const fact of thinNonComp) {
      expect(fact.text, `${fact.id} (${fact.kind})`).toContain("limited evidence");
    }
  });

  it('writes changed pay bands as "B4-B5" or "B5", never "B5 to B5"', () => {
    const d = diffFor({}, { minCompBand: "B5" });
    const comp = d.facts.filter((f) => f.kind === "comp");
    expect(comp.length).toBeGreaterThan(0);
    for (const fact of comp) {
      // Parse the full from/to ranges ("B4-B5 to B5"): comparing substrings would falsely
      // flag the valid "B4-B5 to B5", whose tail reads "B5 to B5".
      const match = /from (B[1-5](?:-B[1-5])?) to (B[1-5](?:-B[1-5])?)/.exec(fact.text);
      expect(match, fact.text).not.toBeNull();
      const [, from, to] = match ?? [];
      expect(from, fact.text).not.toBe(to);
      // bandText collapses a same-band range to one label, never "B5-B5".
      expect(from, fact.text).not.toMatch(/B([1-5])-B\1/);
      expect(to, fact.text).not.toMatch(/B([1-5])-B\1/);
    }
  });

  it("every fact carries evidence, except a changed recommendation", () => {
    // Surveyed across the scenarios below: the ONLY fact kind with empty evidenceIds is
    // "recommended" (it compares two rankings, so it cites no single tool call). A skill
    // fact about an unknown skill DOES carry evidence ids (the skillStats calls that prove
    // the cohort has nothing), so the "unknown skill" exception in the brief never triggers
    // in practice but is allowed here so the test stays true if that changes.
    const scenarios: [object, object][] = [
      [{}, { maxMonths: 24 }],
      [{}, { maxMonths: 36 }],
      [{}, { maxMonths: 12 }],
      [{}, { minCompBand: "B5" }],
      [{}, { remote: true }],
      [{}, { addSkills: ["rust", "go"] }],
      [{}, { maxMonths: 36, minCompBand: "B4", remote: true, addSkills: ["rust"] }],
    ];
    for (const [from, to] of scenarios) {
      for (const fact of diffFor(from, to).facts) {
        const unknownSkill = fact.kind === "skill" && fact.text.includes("no evidence");
        const ok = fact.evidenceIds.length > 0 || fact.kind === "recommended" || unknownSkill;
        expect(ok, `${fact.kind}: ${fact.text}`).toBe(true);
      }
    }
  });

  it("mustMention is true for headline changes and false for background ones", () => {
    const scenarios: [object, object][] = [
      [{}, { maxMonths: 24 }],
      [{ maxMonths: 24 }, {}],
      [{}, { maxMonths: 36 }],
      [{}, { maxMonths: 12 }],
      [{}, { remote: true }],
      [{}, { minCompBand: "B5" }],
    ];
    const seen = new Set<string>();
    for (const [from, to] of scenarios) {
      for (const fact of diffFor(from, to).facts) {
        seen.add(fact.kind);
        if (fact.kind === "route_appeared" || fact.kind === "route_disappeared") {
          expect(fact.mustMention, fact.text).toBe(true);
        }
        if (fact.kind === "recommended") expect(fact.mustMention, fact.text).toBe(true);
        if (
          fact.kind === "risk" ||
          fact.kind === "comp" ||
          fact.kind === "twin_pool" ||
          fact.kind === "timeline"
        ) {
          expect(fact.mustMention, fact.text).toBe(false);
        }
      }
    }
    // Guard against a vacuous pass: every listed kind must have been seen at least once.
    for (const kind of [
      "route_appeared",
      "route_disappeared",
      "recommended",
      "risk",
      "comp",
      "twin_pool",
      "timeline",
    ]) {
      expect(seen.has(kind), kind).toBe(true);
    }
  });

  it("returns facts in a stable order across repeated calls", () => {
    const before = sheetFor({});
    const after = sheetFor({ maxMonths: 24, addSkills: ["rust"] });
    expect(diffSheets(before, after)).toEqual(diffSheets(before, after));
  });
});

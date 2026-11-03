/**
 * Tests for the diff engine. The invariant that matters most: every number inside a fact's text is
 * listed in that fact's `numbers`, because the narrator is only allowed to use listed numbers.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../src/lib/engine";
import { Constraints } from "../src/lib/schemas";
import { numbersIn, supportedNumbers, ungroundedNumbers } from "../src/lib/skeptic/textChecks";
import { EvidenceLedger } from "../src/lib/tools";
import { diffSheets, MONTHS_SHIFT_MIN, RATE_SHIFT_MIN } from "../src/lib/whatif";
import { input } from "./helpers/fixturesData";

/** Diff the plan for `from` against the plan for `to`, sharing one ledger as runWhatIf does. */
const diff = (from: object, to: object) => {
  const ledger = new EvidenceLedger();
  const before = gatherEvidence(ledger, { ...input, constraints: Constraints.parse(from) });
  const after = gatherEvidence(ledger, { ...input, constraints: Constraints.parse(to) });
  return { d: diffSheets(before, after), before, after };
};

const SCENARIOS: [string, object, object][] = [
  ["24 months", {}, { maxMonths: 24 }],
  ["36 months", {}, { maxMonths: 36 }],
  ["12 months (nothing fits)", {}, { maxMonths: 12 }],
  ["pay floor B5", {}, { minCompBand: "B5" }],
  ["remote only", {}, { remote: true }],
  ["remote and no relocation", {}, { remote: true, noRelocation: true }],
  ["skills", {}, { addSkills: ["rust", "go", "k8s"] }],
  ["limits relaxed again", { maxMonths: 24 }, {}],
  ["everything at once", {}, { maxMonths: 36, minCompBand: "B4", remote: true, addSkills: ["rust"] }],
];

describe("diffSheets: facts are grounded", () => {
  it.each(SCENARIOS)("every number in every fact text is listed in the fact (%s)", (_name, from, to) => {
    for (const fact of diff(from, to).d.facts) {
      const unlisted = ungroundedNumbers(fact.text, supportedNumbers(fact.numbers));
      expect(unlisted, `${fact.id}: ${fact.text}`).toEqual([]);
      // and the reverse: a listed number that the text never uses would let a narrator invent it
      const used = new Set(numbersIn(fact.text));
      for (const listed of fact.numbers)
        expect(used.has(listed), `${fact.id} lists ${listed} but never says it`).toBe(true);
    }
  });

  it("gives every fact a unique sequential id and says 'limited evidence' whenever it flags thin", () => {
    for (const [, from, to] of SCENARIOS) {
      const { facts } = diff(from, to).d;
      expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `f${i + 1}`));
      for (const fact of facts.filter((f) => f.thin)) {
        expect(fact.text, fact.id).toMatch(/limited evidence/);
      }
    }
  });

  it("every evidence id a fact cites exists in the ledger that produced the sheets", () => {
    const ledger = new EvidenceLedger();
    const before = gatherEvidence(ledger, { ...input, constraints: Constraints.parse({}) });
    const after = gatherEvidence(ledger, {
      ...input,
      constraints: Constraints.parse({ maxMonths: 24, addSkills: ["rust"] }),
    });
    for (const fact of diffSheets(before, after).facts)
      for (const id of fact.evidenceIds) expect(ledger.has(id), id).toBe(true);
  });
});

describe("diffSheets: what it reports", () => {
  it("reports nothing when nothing changed, including when only risk tolerance moved the order", () => {
    const same = diff({ remote: true }, { remote: true });
    expect(same.d.unchanged).toBe(true);
    expect(same.d.facts).toEqual([]);
    expect(same.d.routes.every((r) => r.status === "unchanged")).toBe(true);
    expect(diff({}, { riskTolerance: "high" }).d.unchanged).toBe(true); // on this input the order does not change
  });

  it("a 24-month limit makes climb and pivot disappear, flags it, and moves the recommendation to jump", () => {
    const { d } = diff({}, { maxMonths: 24 });
    expect(d.routes.map((r) => r.status)).toEqual(["disappeared", "shifted", "disappeared"]);
    expect(d.recommended).toEqual({ before: "climb", after: "jump", changed: true });
    const gone = d.facts.filter((f) => f.kind === "route_disappeared");
    expect(gone.map((f) => f.archetype)).toEqual(["climb", "pivot"]);
    expect(gone.every((f) => f.mustMention)).toBe(true);
    expect(gone[0]?.text).toContain("47 of 55 did before");
    expect(gone[0]?.text).toContain("fastest there took 30 months");
  });

  it("says 'real change' only when the old and new ranges do not overlap, and 'may be noise' otherwise", () => {
    const climb = diff({}, { maxMonths: 36 }).d.facts.find(
      (f) => f.kind === "success_rate" && f.archetype === "climb",
    );
    expect(climb?.text).toContain("no longer overlap");
    expect(climb?.mustMention).toBe(true);
    const jump = diff({}, { maxMonths: 24 }).d.facts.find(
      (f) => f.kind === "success_rate" && f.archetype === "jump",
    );
    expect(jump?.text).toContain("may be noise");
    expect(jump?.mustMention).toBe(false);
  });

  it("reports an appearing route when a limit is relaxed", () => {
    const { d } = diff({ maxMonths: 24 }, {});
    expect(d.routes.map((r) => r.status)).toEqual(["appeared", "shifted", "appeared"]);
    const appeared = d.facts.find((f) => f.kind === "route_appeared" && f.archetype === "climb");
    expect(appeared?.text).toMatch(/^The climb route now has evidence: 47 of 55/);
  });

  it("reports the twin pool changing size, and that a small pool is thin", () => {
    const { d } = diff({}, { remote: true });
    expect(d.facts[0]).toMatchObject({ kind: "twin_pool", numbers: [150, 88], thin: false });
    expect(d.twins).toEqual({ before: 150, after: 88 });
  });

  it("when nothing fits, says no route can be recommended", () => {
    const { d } = diff({}, { maxMonths: 12 });
    expect(d.recommended.after).toBeNull();
    expect(d.facts.find((f) => f.kind === "recommended")?.text).toContain("none can be recommended");
  });

  it("describes skills as an association, notes overlap, and says when the cohort has no evidence", () => {
    const facts = diff({}, { addSkills: ["rust", "go"] }).d.facts.filter((f) => f.kind === "skill");
    expect(facts).toHaveLength(4); // rust on three routes + one 'no evidence' fact for go
    expect(facts[0]?.text).toContain("we cannot tell a difference");
    expect(facts[3]?.text).toBe(
      'The cohort has no evidence about "go", so it cannot change any figure here.',
    );
    expect(facts.every((f) => !/\b(causes?|boosts?)\b/.test(f.text))).toBe(true);
  });

  it("does not repeat skill facts for a skill that was already in the plan", () => {
    expect(diff({ addSkills: ["rust"] }, { addSkills: ["rust"] }).d.facts).toEqual([]);
  });

  it("ignores changes smaller than the thresholds", () => {
    expect(RATE_SHIFT_MIN).toBe(5);
    expect(MONTHS_SHIFT_MIN).toBe(3);
    const { before, after } = diff({}, {});
    const nudged = structuredClone(after);
    const route = nudged.routes[0]!;
    route.reachedRate = [route.reachedRate[0] + 0.03, route.reachedRate[1] + 0.03];
    route.monthsToGoal = [route.monthsToGoal![0] + 1, route.monthsToGoal![1] + 1];
    expect(diffSheets(before, nudged).facts).toEqual([]);
    route.monthsToGoal = [route.monthsToGoal[0] + 2, route.monthsToGoal[1] + 2]; // total shift is now 3 months
    expect(diffSheets(before, nudged).facts.map((f) => f.kind)).toEqual(["timeline"]);
  });

  it("keeps the raw before/after numbers the interface needs to draw the change", () => {
    const climb = diff({}, { maxMonths: 36 }).d.routes[0]!;
    expect(climb).toMatchObject({
      archetype: "climb",
      n: { before: 55, after: 55 },
      reachedN: { before: 47, after: 22 },
    });
    expect(climb.reachedRate.separated).toBe(true);
    expect(climb.rateShift).toBeLessThan(-30);
    expect(climb.radar.speed.before).toBeDefined();
  });
});

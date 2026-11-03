/**
 * Edge tests for the sensitivity tornado. The sample-engineer numbers (swings 83/30/1/1,
 * option labels, tie order, determinism) are pinned in tests/sensitivity.test.ts; these cover
 * the corners around them: several people across role families and regions, a goal nobody
 * reached (zero twins), time limits on the supported edges, risk tolerance moving the
 * baseline without adding a bar, and input immutability with no leakage between calls.
 */
import { describe, expect, it } from "vitest";
import type { EngineInput } from "../src/lib/engine";
import { Constraints, Goal, Profile } from "../src/lib/schemas";
import { findTwins } from "../src/lib/tools";
import { MONTHS_RANGE, rateMid, sensitivityTornado, type TornadoKnob } from "../src/lib/whatif";
import { input } from "./helpers/fixturesData";

/** One person: role family and region from the real cohort, L5 to L6 unless stated otherwise. */
const person = (
  roleFamily: string,
  region: string,
  constraints: object = {},
  targetLevel = "L6",
): EngineInput => ({
  profile: Profile.parse({
    roleFamily,
    level: "L5",
    yearsExperience: 7,
    stack: ["go"],
    region,
  }),
  goal: Goal.parse({ targetLevel, label: targetLevel }),
  constraints: Constraints.parse(constraints),
});

/** A spread of role families and regions that all exist in the cohort. */
const people: EngineInput[] = [
  input, // backend, L5 to L6, IN-south, no constraints
  person("platform", "US-east"),
  person("platform", "US-east", { maxMonths: 24, minCompBand: "B4" }),
  person("ml", "SEA"),
  person("frontend", "EU-west", { remote: true }),
  person("sre", "US-west", { noRelocation: true }),
  person("embedded", "EU-west", { maxMonths: 30 }),
];

/** Tie order when two bars have the same swing: the order they are built in. */
const KNOB_ORDER: readonly TornadoKnob[] = ["remote", "noRelocation", "maxMonths", "minCompBand"];

describe("sensitivityTornado edges", () => {
  it("for several people: four bars, one current option each, whole-number swings, sorted with ties in knob order", () => {
    expect(people.length).toBeGreaterThan(1);
    for (const who of people) {
      const tornado = sensitivityTornado(who);
      expect(tornado.bars, who.profile.roleFamily).toHaveLength(4);
      expect(new Set(tornado.bars.map((bar) => bar.knob))).toEqual(new Set(KNOB_ORDER));
      for (const bar of tornado.bars) {
        const current = bar.options.filter((option) => option.current);
        expect(current, `${who.profile.roleFamily}/${bar.knob}`).toHaveLength(1);
        expect(current[0]?.metric).toEqual(tornado.baseline);
        expect(Number.isInteger(bar.swing), bar.knob).toBe(true);
        expect(bar.swing, bar.knob).toBeGreaterThanOrEqual(0);
        expect(bar.swing, bar.knob).toBeLessThanOrEqual(100);
        expect(rateMid(bar.worst.metric), bar.knob).toBeLessThanOrEqual(rateMid(bar.best.metric));
      }
      // Sorted by swing, widest first; ties keep the knob order above.
      const expected = [...tornado.bars]
        .sort((a, b) => b.swing - a.swing || KNOB_ORDER.indexOf(a.knob) - KNOB_ORDER.indexOf(b.knob))
        .map((bar) => bar.knob);
      expect(tornado.bars.map((bar) => bar.knob)).toEqual(expected);
    }
  });

  it("with a goal nobody reached, does not throw: the baseline route is null and every swing is 0", () => {
    // How this input was found: counting endLevel in data/cohort.synthetic.json gives only
    // L6 (437 records) and EM1 (47 records), so a goal of EM2 matches no record at all.
    const nobody = person("backend", "IN-south", {}, "EM2");
    expect(findTwins(nobody.profile, nobody.goal).n).toBe(0);
    expect(() => sensitivityTornado(nobody)).not.toThrow();
    const tornado = sensitivityTornado(nobody);
    expect(tornado.baseline).toMatchObject({ route: null, reachedN: 0, twins: 0 });
    expect(tornado.bars).toHaveLength(4);
    for (const bar of tornado.bars) {
      expect(bar.swing, bar.knob).toBe(0);
      for (const option of bar.options) expect(option.metric.route, option.label).toBeNull();
    }
  });

  it("at the supported month edges (6 and 120) and on a tried value (24): no duplicates, ascending, no limit last", () => {
    for (const months of [MONTHS_RANGE.min, MONTHS_RANGE.max, 24]) {
      const bar = sensitivityTornado(person("backend", "IN-south", { maxMonths: months })).bars.find(
        (candidate) => candidate.knob === "maxMonths",
      );
      const labels = bar?.options.map((option) => option.label) ?? [];
      expect(new Set(labels).size, `${months}`).toBe(labels.length); // 24 must appear exactly once
      expect(labels.at(-1), `${months}`).toBe("no limit");
      const values = labels.slice(0, -1).map((label) => Number.parseInt(label, 10));
      expect(values, `${months}`).toEqual([...values].sort((a, b) => a - b));
      expect(values, `${months}`).toContain(months);
      expect(bar?.options.find((option) => option.current)?.label).toBe(`${months} months`);
    }
  });

  it("riskTolerance adds no bar, and the baseline route stays a route or null under every tolerance", () => {
    const scenarios: object[] = [
      {},
      { maxMonths: 24 },
      { minCompBand: "B5" },
      { maxMonths: 24, minCompBand: "B4" },
      { remote: true, noRelocation: true },
    ];
    for (const constraints of scenarios) {
      for (const riskTolerance of ["low", "medium", "high"] as const) {
        const tornado = sensitivityTornado(person("backend", "IN-south", { ...constraints, riskTolerance }));
        expect(tornado.bars.map((bar) => bar.knob).sort()).toEqual([...KNOB_ORDER].sort());
        expect(["climb", "jump", "pivot", null]).toContain(tornado.baseline.route);
      }
    }
    // And the tolerance can actually move the baseline: a B5 floor recommends jump when
    // cautious but pivot when chasing upside (verified by running the code).
    const routeFor = (riskTolerance: "low" | "medium" | "high"): unknown =>
      sensitivityTornado(person("backend", "IN-south", { minCompBand: "B5", riskTolerance })).baseline.route;
    expect([routeFor("low"), routeFor("medium"), routeFor("high")]).toEqual(["jump", "jump", "pivot"]);
  });

  it("does not mutate its input and does not leak evidence between calls", () => {
    const subjects = [...people, person("backend", "IN-south", {}, "EM2")];
    for (const who of subjects) {
      const snapshot = structuredClone(who);
      sensitivityTornado(who);
      expect(who).toEqual(snapshot);
    }
    // A call for someone else in between must not change the answer.
    const [first, second] = [subjects[0] as EngineInput, subjects[1] as EngineInput];
    const before = sensitivityTornado(first);
    sensitivityTornado(second);
    expect(sensitivityTornado(first)).toEqual(before);
  });
});

/**
 * Edge tests for "what would it take". The headline searches (12 months to 23, B5 down to
 * B4/B3, dropping remote-only, ordering, grounded sentences) are pinned in
 * tests/sensitivity.test.ts; these cover the properties around them: alreadyMet matching
 * meetsTarget over a grid, unset knobs never offered over all 16 set/unset combinations,
 * minimality of every option (one step less fails), the 120-month and B1 corners, a zero
 * target, non-null routes in every option, and the sentence shape with its evidence flag.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence, type EngineInput } from "../src/lib/engine";
import { Constraints, Goal, Profile } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import { BANDS } from "../src/lib/tools/stats";
import {
  DEFAULT_TARGET,
  headlineMetric,
  meetsTarget,
  MONTHS_RANGE,
  whatWouldItTake,
  type HeadlineMetric,
  type Relaxation,
  type Target,
  type WhatItTake,
} from "../src/lib/whatif";
import { input } from "./helpers/fixturesData";

const withC = (c: object, base: EngineInput = input): EngineInput => ({
  ...base,
  constraints: Constraints.parse(c),
});

/** Cached search: the function is pure, and the grids below ask the same questions. */
const takeCache = new Map<string, WhatItTake>();
const take = (c: object, target: Target, base: EngineInput = input): WhatItTake => {
  const key = JSON.stringify([base.profile, base.goal, c, target]);
  const hit = takeCache.get(key);
  if (hit !== undefined) return hit;
  const result = whatWouldItTake(withC(c, base), target);
  takeCache.set(key, result);
  return result;
};
const metricFor = (c: object, base: EngineInput = input): HeadlineMetric =>
  headlineMetric(gatherEvidence(new EvidenceLedger(), withC(c, base)));

/** The embedded cohort, where a remote-only requirement leaves thin evidence. */
const embedded: EngineInput = {
  ...input,
  profile: Profile.parse({ ...input.profile, roleFamily: "embedded" }),
};

/** A person with no twins at all: no cohort record ends at EM2 (see tests/tornadoEdges.test.ts). */
const noTwins: EngineInput = { ...input, goal: Goal.parse({ targetLevel: "EM2", label: "EM2" }) };

/** Constraint sets crossed with targets in the grid tests below. */
const GRID: Array<{ base: EngineInput; c: object }> = [
  { base: input, c: { maxMonths: 12 } },
  { base: input, c: { maxMonths: 18 } },
  { base: input, c: { maxMonths: 24 } },
  { base: input, c: { minCompBand: "B5" } },
  { base: input, c: { minCompBand: "B4" } },
  { base: input, c: { minCompBand: "B3" } },
  { base: input, c: { maxMonths: 12, minCompBand: "B5" } },
  { base: input, c: { maxMonths: 24, minCompBand: "B5" } },
  { base: input, c: { noRelocation: true, minCompBand: "B5", maxMonths: 24 } },
  { base: input, c: { remote: true, maxMonths: 18 } },
  { base: embedded, c: { remote: true } },
  { base: embedded, c: { remote: true, maxMonths: 18 } },
  { base: embedded, c: { maxMonths: 12 } },
];
const GRID_TARGETS: Target[] = [
  DEFAULT_TARGET,
  { minReached: 5, minRate: 0.3 },
  { minReached: 30, minRate: 0.6 },
  { minReached: 40, minRate: 0.6 },
  { minReached: 8, minRate: 0.4 },
];

/** The minCompBand value one step stricter than `to` along the relaxation path. */
const oneStepBack = (to: string): string => {
  if (to === "no floor") return "B1";
  const band = BANDS[BANDS.findIndex((candidate) => candidate === to) + 1];
  if (band === undefined) throw new Error(`no stricter band above ${to}`);
  return band;
};

/** The phrase every option sentence for a knob must begin with. */
const expectedStart = (option: Relaxation): string =>
  option.knob === "maxMonths"
    ? `Raise your time limit from ${option.from} to ${option.to}`
    : option.knob === "minCompBand"
      ? `Lower your minimum pay band from ${option.from} to ${option.to}`
      : option.knob === "remote"
        ? "Drop the remote-only requirement"
        : "Allow relocation";

describe("whatWouldItTake edges", () => {
  it("alreadyMet is true exactly when the current metric meets the target", () => {
    let met = 0;
    let unmet = 0;
    for (const { base, c } of GRID) {
      for (const target of GRID_TARGETS) {
        const result = take(c, target, base);
        expect(result.current).toEqual(metricFor(c, base));
        expect(result.alreadyMet, JSON.stringify({ c, target })).toBe(meetsTarget(result.current, target));
        if (result.alreadyMet) {
          met += 1;
          expect(result.options).toEqual([]);
          expect(result.note).toBeUndefined();
        } else {
          unmet += 1;
          // A plain sentence exactly when no single change is enough.
          expect(result.note !== undefined).toBe(result.options.length === 0);
        }
      }
    }
    expect(met).toBeGreaterThan(0);
    expect(unmet).toBeGreaterThan(0);
  }, 30_000);

  it("never offers to relax a knob that is not set, over every combination of set and unset knobs", () => {
    let seen = 0;
    for (const useMonths of [true, false]) {
      for (const useBand of [true, false]) {
        for (const useRemote of [true, false]) {
          for (const useReloc of [true, false]) {
            const c: Record<string, unknown> = {};
            if (useMonths) c.maxMonths = 12;
            if (useBand) c.minCompBand = "B5";
            if (useRemote) c.remote = true;
            if (useReloc) c.noRelocation = true;
            const set = new Set([
              ...(useMonths ? ["maxMonths"] : []),
              ...(useBand ? ["minCompBand"] : []),
              ...(useRemote ? ["remote"] : []),
              ...(useReloc ? ["noRelocation"] : []),
            ]);
            for (const target of [DEFAULT_TARGET, { minReached: 40, minRate: 0.6 }]) {
              for (const option of take(c, target).options) {
                expect(set.has(option.knob), JSON.stringify(c)).toBe(true);
                seen += 1;
              }
            }
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    // An explicit false is unset too: it filters nobody out.
    const off = whatWouldItTake(withC({ remote: false, noRelocation: false, maxMonths: 12 }));
    expect(off.options.map((option) => option.knob)).not.toContain("remote");
    expect(off.options.map((option) => option.knob)).not.toContain("noRelocation");
  }, 30_000);

  it("every option is minimal: one step less relaxation does not meet the target", () => {
    let checkedMonths = 0;
    let checkedBands = 0;
    for (const { base, c } of GRID) {
      for (const target of GRID_TARGETS) {
        for (const option of take(c, target, base).options) {
          if (option.knob === "maxMonths") {
            const months = Number.parseInt(option.to, 10);
            expect(
              meetsTarget(metricFor({ ...c, maxMonths: months - 1 }, base), target),
              `${option.from} to ${option.to}`,
            ).toBe(false);
            checkedMonths += 1;
          } else if (option.knob === "minCompBand") {
            expect(
              meetsTarget(metricFor({ ...c, minCompBand: oneStepBack(option.to) }, base), target),
              `${option.from} to ${option.to}`,
            ).toBe(false);
            checkedBands += 1;
          }
          // Boolean knobs have no intermediate step between on and off: not applicable.
        }
      }
    }
    expect(checkedMonths).toBeGreaterThan(0);
    expect(checkedBands).toBeGreaterThan(0);
    expect(checkedMonths + checkedBands).toBeGreaterThan(10);
  });

  it("a time limit at the supported maximum (120) has nothing to raise: no maxMonths option, no throw", () => {
    // The search runs from the current limit plus one up to MONTHS_RANGE.max, so at 120
    // the loop is empty: nothing to offer, and nothing that can go wrong.
    expect(MONTHS_RANGE.max).toBe(120);
    for (const target of [DEFAULT_TARGET, { minReached: 100, minRate: 0.99 }]) {
      const result = whatWouldItTake(withC({ maxMonths: 120 }), target);
      expect(result.options.map((option) => option.knob)).not.toContain("maxMonths");
    }
    const both = whatWouldItTake(withC({ maxMonths: 120, minCompBand: "B5" }), {
      minReached: 100,
      minRate: 0.99,
    });
    expect(both.options.map((option) => option.knob)).not.toContain("maxMonths");
    expect(() =>
      whatWouldItTake(withC({ maxMonths: 120 }), { minReached: 100, minRate: 0.99 }),
    ).not.toThrow();
  });

  it("a B1 floor can only be lowered to no floor, which filters nothing, so it never offers a pay option", () => {
    // The search starts one band below the current one, so from B1 (index 0) the only
    // candidate is band -1, "no floor". And B1 is the lowest band, so the floor keeps
    // every twin: for the sample engineer the metric equals the no-floor metric exactly.
    expect(metricFor({ minCompBand: "B1" })).toEqual(metricFor({}));
    expect(whatWouldItTake(withC({ minCompBand: "B1" })).alreadyMet).toBe(true);
    const strict = whatWouldItTake(withC({ minCompBand: "B1" }), { minReached: 48, minRate: 0.5 });
    expect(strict.alreadyMet).toBe(false);
    expect(strict.options).toEqual([]);
    expect(strict.note).toContain("No single change");
  });

  it("a zero target is met by any route, but a missing route still fails it", () => {
    const zero = { minReached: 0, minRate: 0 };
    // Any recommended route qualifies: eligibility needs reachedN >= 1, and a range
    // middle is never below 0. So the sample engineer with no limits is already there.
    expect(whatWouldItTake(withC({}), zero).alreadyMet).toBe(true);
    // But meetsTarget still requires a route, so a person with no route fails even this:
    // nobody reached Staff within 12 months, and the EM2 goal has no twins at all.
    expect(meetsTarget(metricFor({ maxMonths: 12 }), zero)).toBe(false);
    expect(whatWouldItTake(withC({ maxMonths: 12 }), zero).alreadyMet).toBe(false);
    expect(meetsTarget(metricFor({}, noTwins), zero)).toBe(false);
    expect(whatWouldItTake(noTwins, zero).alreadyMet).toBe(false);
  });

  it("no option ever points at a missing route: every option's metric meets the target", () => {
    let seen = 0;
    for (const { base, c } of GRID) {
      for (const target of GRID_TARGETS) {
        for (const option of take(c, target, base).options) {
          expect(option.metric.route).not.toBeNull();
          expect(meetsTarget(option.metric, target)).toBe(true);
          seen += 1;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("each sentence starts with its knob's phrase, ends with a full stop, and flags thin evidence exactly when thin", () => {
    const knobs = new Set<string>();
    let thin = 0;
    let solid = 0;
    for (const { base, c } of GRID) {
      for (const target of GRID_TARGETS) {
        for (const option of take(c, target, base).options) {
          expect(option.text.startsWith(expectedStart(option)), option.text).toBe(true);
          expect(option.text.endsWith("."), option.text).toBe(true);
          expect(option.text.includes("(limited evidence)"), option.text).toBe(option.metric.thin);
          knobs.add(option.knob);
          if (option.metric.thin) thin += 1;
          else solid += 1;
        }
      }
    }
    // All four phrases and both sides of the flag must actually appear, or the checks above
    // would pass without checking anything.
    expect(knobs).toEqual(new Set(["maxMonths", "minCompBand", "remote", "noRelocation"]));
    expect(thin).toBeGreaterThan(0);
    expect(solid).toBeGreaterThan(0);
  });
});

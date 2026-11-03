/**
 * Tests for the sensitivity tornado and "what would it take". Numbers are the real ones for the sample
 * engineer (backend L5 to Staff, IN-south, seed 1026), so a change to the data or the rules shows here first.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../src/lib/engine";
import { Constraints, Profile } from "../src/lib/schemas";
import { numbersIn, supportedNumbers, ungroundedNumbers } from "../src/lib/skeptic/textChecks";
import { EvidenceLedger } from "../src/lib/tools";
import {
  headlineMetric,
  meetsTarget,
  MONTH_OPTIONS,
  rateMid,
  sensitivityTornado,
  whatWouldItTake,
  type HeadlineMetric,
} from "../src/lib/whatif";
import { input } from "./helpers/fixturesData";

const withC = (c: object, base = input) => ({ ...base, constraints: Constraints.parse(c) });
const metricFor = (c: object, base = input) =>
  headlineMetric(gatherEvidence(new EvidenceLedger(), withC(c, base)));
const embedded = { ...input, profile: Profile.parse({ ...input.profile, roleFamily: "embedded" }) };

describe("headlineMetric", () => {
  it("is the recommended route's success range with the number of engineers behind it", () => {
    expect(metricFor({})).toEqual({
      route: "climb",
      rate: [0.74, 0.92],
      reachedN: 47,
      n: 55,
      twins: 150,
      thin: false,
    });
  });

  it("says there is no route, rather than inventing a zero, when nobody met the limits", () => {
    expect(metricFor({ maxMonths: 12 })).toEqual({
      route: null,
      rate: [0, 0],
      reachedN: 0,
      n: 0,
      twins: 150,
      thin: true,
    });
  });

  it("rateMid is the middle of the range, and 0 with no route", () => {
    expect(rateMid(metricFor({}))).toBeCloseTo(0.83, 5);
    expect(rateMid(metricFor({ maxMonths: 12 }))).toBe(0);
  });
});

describe("sensitivityTornado", () => {
  const t = sensitivityTornado(withC({}));

  it("puts the time limit first, then the pay floor, for the sample engineer", () => {
    expect(t.bars.map((b) => [b.knob, b.swing])).toEqual([
      ["maxMonths", 83],
      ["minCompBand", 30],
      ["remote", 1],
      ["noRelocation", 1],
    ]);
  });

  it("measures the baseline exactly as the plan does", () => {
    expect(t.baseline).toEqual(metricFor({}));
  });

  it("marks exactly one option per bar as the current one, and it equals the baseline", () => {
    for (const bar of t.bars) {
      const current = bar.options.filter((o) => o.current);
      expect(current, bar.knob).toHaveLength(1);
      expect(current[0]?.metric).toEqual(t.baseline);
    }
  });

  it("defines swing as best minus worst, in whole percentage points, with worst never above best", () => {
    for (const bar of t.bars) {
      const mids = bar.options.map((o) => rateMid(o.metric));
      expect(bar.swing).toBe(Math.round((Math.max(...mids) - Math.min(...mids)) * 100));
      expect(rateMid(bar.worst.metric)).toBeLessThanOrEqual(rateMid(bar.best.metric));
    }
    const time = t.bars[0]!;
    expect(time.worst.label).toBe("12 months");
    expect(time.best.label).toBe("48 months"); // first of the tied best options
  });

  it("success never falls as the time limit loosens (for this engineer)", () => {
    const months = t.bars.find((b) => b.knob === "maxMonths")!;
    const mids = months.options.map((o) => rateMid(o.metric));
    expect(months.options.map((o) => o.label)).toEqual([
      "12 months",
      "18 months",
      "24 months",
      "36 months",
      "48 months",
      "60 months",
      "no limit",
    ]);
    for (let i = 1; i < mids.length; i++)
      expect(mids[i]!, months.options[i]!.label).toBeGreaterThanOrEqual(mids[i - 1]!);
  });

  it("includes the person's own unusual limit in its place on the scale, and marks it current", () => {
    const own = sensitivityTornado(withC({ maxMonths: 30 })).bars.find((b) => b.knob === "maxMonths")!;
    expect(own.options.map((o) => o.label)).toEqual([
      "12 months",
      "18 months",
      "24 months",
      "30 months",
      "36 months",
      "48 months",
      "60 months",
      "no limit",
    ]);
    expect(own.options.find((o) => o.current)?.label).toBe("30 months");
    expect(MONTH_OPTIONS).toEqual([12, 18, 24, 36, 48, 60]);
  });

  it("measures the pay floor with no floor, B3, B4 and B5, and the person's own floor is current", () => {
    const pay = t.bars.find((b) => b.knob === "minCompBand")!;
    expect(pay.options.map((o) => o.label)).toEqual(["no floor", "B3", "B4", "B5"]);
    expect(pay.options[0]?.current).toBe(true);
    const own = sensitivityTornado(withC({ minCompBand: "B4" })).bars.find((b) => b.knob === "minCompBand")!;
    expect(own.options.find((o) => o.current)?.label).toBe("B4");
  });

  it("keeps ties in the order remote, noRelocation, maxMonths, minCompBand", () => {
    const tied = sensitivityTornado(withC({ remote: true, noRelocation: true }));
    const small = tied.bars.filter((b) => b.swing <= 1).map((b) => b.knob);
    expect(small).toEqual(["remote", "noRelocation"]);
  });

  it("leaves out risk tolerance and skills, which change no success rate", () => {
    expect(t.bars.map((b) => b.knob)).not.toContain("riskTolerance");
    expect(t.bars.map((b) => b.knob)).not.toContain("addSkills");
    expect(sensitivityTornado(withC({ addSkills: ["rust", "go"] }))).toEqual(t);
  });

  it("is deterministic and does not modify the input", () => {
    const original = withC({ maxMonths: 24 });
    const snapshot = structuredClone(original);
    expect(sensitivityTornado(original)).toEqual(sensitivityTornado(original));
    expect(original).toEqual(snapshot);
  });

  it("every option reports a sample size, so no bar is a bare number", () => {
    for (const bar of t.bars) for (const o of bar.options) expect(o.metric.twins).toBeGreaterThanOrEqual(0);
    expect(t.bars[0]?.options[0]?.metric).toMatchObject({ route: null, reachedN: 0 });
  });
});

describe("whatWouldItTake", () => {
  const take = (c: object, target?: { minReached: number; minRate: number }, base = input) =>
    whatWouldItTake(withC(c, base), target);

  it("has nothing to relax when the constraints already reach the target", () => {
    expect(take({})).toMatchObject({ alreadyMet: true, options: [] });
    expect(take({ minCompBand: "B5" }).alreadyMet).toBe(true);
  });

  it("finds the smallest time limit that works, and the one below it does not", () => {
    const result = take({ maxMonths: 12 });
    expect(result.alreadyMet).toBe(false);
    const [option] = result.options;
    expect(result.options).toHaveLength(1);
    expect(option).toMatchObject({ knob: "maxMonths", from: "12 months", to: "23 months", steps: 11 });
    expect(option?.metric).toMatchObject({ route: "jump", reachedN: 34 });
    expect(meetsTarget(metricFor({ maxMonths: 23 }), result.target)).toBe(true);
    expect(meetsTarget(metricFor({ maxMonths: 22 }), result.target)).toBe(false);
  });

  it("gives the same answer from 18 months, because it only raises the limit as far as needed", () => {
    expect(take({ maxMonths: 18 }).options[0]).toMatchObject({ to: "23 months", steps: 5 });
  });

  it("keeps the pay floor when it relaxes the time limit (one knob at a time)", () => {
    const [option] = take({ maxMonths: 12, minCompBand: "B5" }).options;
    expect(option).toMatchObject({ knob: "maxMonths", to: "26 months" });
    expect(option?.metric).toEqual(metricFor({ maxMonths: 26, minCompBand: "B5" }));
  });

  it("lowers a pay floor one band at a time, counting the bands dropped", () => {
    expect(take({ minCompBand: "B5" }, { minReached: 40, minRate: 0.6 }).options[0]).toMatchObject({
      knob: "minCompBand",
      from: "B5",
      to: "B4",
      steps: 1,
    });
    expect(take({ minCompBand: "B5" }, { minReached: 45, minRate: 0.5 }).options[0]).toMatchObject({
      to: "B3",
      steps: 2,
    });
  });

  it("offers to drop a remote-only requirement when that is what makes the evidence thin", () => {
    const [option] = take({ remote: true }, undefined, embedded).options;
    expect(option).toMatchObject({ knob: "remote", from: "on", to: "off", steps: 1 });
    expect(option?.text).toMatch(/^Drop the remote-only requirement: the climb route/);
    expect(option?.text).toContain("(limited evidence)"); // 13 engineers is thin, so the sentence must say so
  });

  it("says plainly when no single change is enough", () => {
    const result = take({ remote: true, maxMonths: 18 }, undefined, embedded);
    expect(result.options).toEqual([]);
    expect(result.note).toContain("No single change to your constraints is enough");
  });

  it("only ever relaxes constraints the person actually set", () => {
    expect(take({}, { minReached: 1000, minRate: 0.99 }).options).toEqual([]); // nothing to relax, target out of reach
    const knobs = take({ maxMonths: 12 }).options.map((o) => o.knob);
    expect(knobs).toEqual(["maxMonths"]);
  });

  it("changes only one knob per option: each option's metric equals that single change", () => {
    const base = { remote: true, noRelocation: true, maxMonths: 18 };
    for (const o of take(base).options) {
      const patch =
        o.knob === "maxMonths"
          ? { ...base, maxMonths: Number.parseInt(o.to, 10) }
          : { ...base, [o.knob]: false };
      expect(o.metric, o.knob).toEqual(metricFor(patch));
    }
  });

  it("orders options by the success they give, best first (not in the order the knobs are searched)", () => {
    // Searched in the order maxMonths, minCompBand, noRelocation; the pay-band option gives the best success.
    const options = take(
      { noRelocation: true, minCompBand: "B5", maxMonths: 24 },
      { minReached: 8, minRate: 0.4 },
    ).options;
    expect(options.map((o) => [o.knob, o.to])).toEqual([
      ["minCompBand", "B4"],
      ["maxMonths", "25 months"],
      ["noRelocation", "off"],
    ]);
    const mids = options.map((o) => rateMid(o.metric));
    expect([...mids].sort((a, b) => b - a)).toEqual(mids);
  });

  it("writes sentences whose every number is listed", () => {
    const cases: [object, typeof embedded?][] = [
      [{ maxMonths: 12 }, undefined],
      [{ minCompBand: "B5" }, undefined],
      [{ remote: true }, embedded],
    ];
    for (const [c, base] of cases) {
      const target = c && "minCompBand" in c ? { minReached: 40, minRate: 0.6 } : undefined;
      for (const o of take(c, target, base ?? input).options) {
        expect(ungroundedNumbers(o.text, supportedNumbers(o.numbers)), o.text).toEqual([]);
        const used = new Set(numbersIn(o.text));
        for (const listed of o.numbers) expect(used.has(listed), `${o.text} lists ${listed}`).toBe(true);
      }
    }
  });

  it("respects the target: a stricter target needs a bigger relaxation", () => {
    const loose = take({ maxMonths: 12 }, { minReached: 5, minRate: 0.3 }).options[0]!;
    const strict = take({ maxMonths: 12 }, { minReached: 30, minRate: 0.6 }).options[0]!;
    expect(strict.steps).toBeGreaterThan(loose.steps);
  });

  it("meetsTarget needs a route, enough engineers and a high enough middle", () => {
    const m = (over: Partial<HeadlineMetric>): HeadlineMetric => ({
      route: "jump",
      rate: [0.4, 0.7],
      reachedN: 12,
      n: 20,
      twins: 40,
      thin: false,
      ...over,
    });
    const target = { minReached: 10, minRate: 0.5 };
    expect(meetsTarget(m({}), target)).toBe(true);
    expect(meetsTarget(m({ route: null }), target)).toBe(false);
    expect(meetsTarget(m({ reachedN: 9 }), target)).toBe(false);
    expect(meetsTarget(m({ rate: [0.3, 0.68] }), target)).toBe(false); // middle 0.49
    expect(meetsTarget(m({ rate: [0.3, 0.7] }), target)).toBe(true); // middle exactly 0.5
  });
});

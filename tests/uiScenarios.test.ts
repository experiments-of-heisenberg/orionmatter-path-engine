/** Saved scenarios: the rules (four at most, no duplicates, honest "highest") and the wording. */
import { describe, expect, it } from "vitest";
import {
  MAX_NAME,
  MAX_SCENARIOS,
  addScenario,
  constraintsText,
  headlineOf,
  headlineText,
  leader,
  removeScenario,
  renameScenario,
  type Scenario,
} from "../src/ui/scenarios";
import { withLimit, withMinBand } from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { embeddedPerson, exploreFor } from "./helpers/ui";

const base = SAMPLE_PERSON.constraints;
const sheet = exploreFor().data;

function saved(list: Scenario[], c = base, s = sheet): Scenario[] {
  const r = addScenario(list, c, s);
  if (!r.ok) throw new Error(r.message);
  return r.list;
}
const scenario = (id: string, rate: [number, number] | null): Scenario => ({
  id,
  name: id,
  constraints: base,
  headline: { route: rate ? "climb" : null, rate, months: null, n: 10, reachedN: 5, thin: false },
});

describe("headlines", () => {
  it("takes the start-here route as a range with its window and counts", () => {
    expect(headlineOf(sheet)).toEqual({
      route: "climb",
      rate: [0.74, 0.92],
      months: [34, 40],
      n: 55,
      reachedN: 47,
      thin: false,
    });
    expect(headlineText(headlineOf(sheet))).toBe(
      "Climb \u00b7 74\u201392% \u00b7 34\u201340 months \u00b7 55 engineers",
    );
  });

  it("says plainly when no route has anyone who met the limits", () => {
    const none = headlineOf(exploreFor({ maxMonths: 12 }).data);
    expect(none.route).toBeNull();
    expect(headlineText(none)).toBe("No route has anyone who met your limits");
  });

  it("flags limited evidence in the sentence", () => {
    const thin = headlineOf(exploreFor({}, embeddedPerson()).data);
    expect(headlineText(thin)).toMatch(/limited evidence$/);
  });

  it("describes constraints in words, or 'No limits set'", () => {
    expect(constraintsText(base)).toBe("No limits set");
    expect(constraintsText(withMinBand(withLimit(base, 24), "B4"))).toBe(
      "Within 24 months, Pay B4 or higher",
    );
  });
});

describe("adding", () => {
  it("names scenarios A, B, C, D and stores normalised constraints with the headline", () => {
    let list = saved([]);
    expect(list.map((s) => s.name)).toEqual(["Scenario A"]);
    list = saved(list, withLimit(base, 24), exploreFor({ maxMonths: 24 }).data);
    list = saved(list, withLimit(base, 36), exploreFor({ maxMonths: 36 }).data);
    list = saved(list, withLimit(base, 48), exploreFor({ maxMonths: 48 }).data);
    expect(list.map((s) => s.id)).toEqual(["sc-A", "sc-B", "sc-C", "sc-D"]);
    expect(list[1]?.headline.route).toBe("jump");
  });

  it("refuses a fifth, saying why, and leaves the list as it was", () => {
    let list: Scenario[] = [];
    for (const m of [12, 24, 36, 48])
      list = saved(list, withLimit(base, m), exploreFor({ maxMonths: m }).data);
    const result = addScenario(list, withLimit(base, 60), sheet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("full");
      expect(result.message).toContain(`${MAX_SCENARIOS} scenarios`);
      expect(result.list).toEqual(list);
    }
  });

  it("refuses the same settings twice, naming the scenario that has them, even if written differently", () => {
    const list = saved([]);
    const result = addScenario(list, { ...base, remote: false }, sheet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("duplicate");
      expect(result.message).toBe("These settings are already saved as Scenario A.");
    }
  });

  it("reuses the first free letter after one is removed", () => {
    let list = saved([]);
    list = saved(list, withLimit(base, 24), exploreFor({ maxMonths: 24 }).data);
    list = removeScenario(list, "sc-A");
    list = saved(list, withLimit(base, 36), exploreFor({ maxMonths: 36 }).data);
    expect(list.map((s) => s.id).sort()).toEqual(["sc-A", "sc-B"]);
  });

  it("does not change the list it was given", () => {
    const list = saved([]);
    const copy = structuredClone(list);
    addScenario(list, withLimit(base, 24), sheet);
    expect(list).toEqual(copy);
  });
});

describe("renaming and removing", () => {
  const list = saved([]);
  it("renames, trims, collapses spaces and cuts to the longest name", () => {
    expect(renameScenario(list, "sc-A", "  Stay   put ")[0]?.name).toBe("Stay put");
    expect(renameScenario(list, "sc-A", "x".repeat(100))[0]?.name).toHaveLength(MAX_NAME);
  });
  it("ignores a blank name and an unknown id", () => {
    expect(renameScenario(list, "sc-A", "   ")[0]?.name).toBe("Scenario A");
    expect(renameScenario(list, "nope", "x")).toEqual(list);
  });
  it("removes by id", () => {
    expect(removeScenario(list, "sc-A")).toEqual([]);
    expect(removeScenario(list, "nope")).toEqual(list);
  });
});

describe("leader is honest about ties and overlap", () => {
  it("needs two scenarios with a route", () => {
    expect(leader([])).toBeNull();
    expect(leader([scenario("a", [0.5, 0.7])])).toBeNull();
    expect(leader([scenario("a", [0.5, 0.7]), scenario("b", null)])).toBeNull();
  });
  it("is clear only when the leader's low end is above the runner-up's high end", () => {
    expect(leader([scenario("a", [0.7, 0.9]), scenario("b", [0.3, 0.5])])).toEqual({ id: "a", clear: true });
    expect(leader([scenario("a", [0.5, 0.9]), scenario("b", [0.3, 0.6])])).toEqual({ id: "a", clear: false });
    expect(leader([scenario("a", [0.5, 0.7]), scenario("b", [0.7, 0.9])])).toEqual({ id: "b", clear: false });
  });
  it("a tie has no leader", () => {
    expect(leader([scenario("a", [0.4, 0.6]), scenario("b", [0.3, 0.7])])).toBeNull();
  });
});

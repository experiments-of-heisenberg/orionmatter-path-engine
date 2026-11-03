/** Edge cases for saved scenarios: ties, odd headline ranges, id reuse, names, and wording corners. */
import { describe, expect, it } from "vitest";
import { withLimit } from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";
import {
  MAX_NAME,
  MAX_SCENARIOS,
  addScenario,
  headlineText,
  leader,
  removeScenario,
  renameScenario,
  type Headline,
  type Scenario,
} from "../src/ui/scenarios";
import { exploreFor } from "./helpers/ui";

const base = SAMPLE_PERSON.constraints;
const sheet = exploreFor().data;

const scenario = (id: string, rate: [number, number] | null, extra: Partial<Headline> = {}): Scenario => ({
  id,
  name: id,
  constraints: base,
  headline: { route: rate ? "climb" : null, rate, months: null, n: 10, reachedN: 5, thin: false, ...extra },
});

/** A small seeded generator, so the fuzz loop below is deterministic. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("leader with ties and odd ranges", () => {
  it("four scenarios on the same headline rate have no leader", () => {
    const list = ["a", "b", "c", "d"].map((id) => scenario(id, [0.5, 0.7]));
    expect(leader(list)).toBeNull();
  });

  it("two scenarios where one has no rate have no leader, whichever side is null", () => {
    expect(leader([scenario("a", null), scenario("b", [0.5, 0.7])])).toBeNull();
    expect(leader([scenario("a", null), scenario("b", null)])).toBeNull();
  });

  it("negative or reversed ranges do not throw and still pick by the middle", () => {
    const list = [scenario("neg", [-0.5, -0.1]), scenario("rev", [0.9, 0.3])];
    expect(leader(list)).toEqual({ id: "rev", clear: true });
    expect(leader([scenario("a", [0.9, 0.3])])).toBeNull(); // one scenario is never enough
  });
});

describe("scenario ids", () => {
  it("with a hand-built list holding a non-sc-X id, the first free letter is chosen", () => {
    const list = [scenario("custom", [0.5, 0.7])];
    const result = addScenario(list, withLimit(base, 24), sheet);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added.id).toBe("sc-A");
      expect(result.added.name).toBe("Scenario A");
    }
  });

  it("ids stay unique and the list stays within four across 50 random add/remove steps", () => {
    const random = mulberry32(13);
    const sheets = [undefined, 24, 36, 48, 12].map((maxMonths) =>
      exploreFor(maxMonths === undefined ? {} : { maxMonths }),
    );
    let list: Scenario[] = [];
    for (let step = 0; step < 50; step++) {
      if (list.length > 0 && random() < 0.4) {
        const victim = list[Math.floor(random() * list.length)] as Scenario;
        list = removeScenario(list, victim.id);
      } else {
        const pick = sheets[Math.floor(random() * sheets.length)] as (typeof sheets)[number];
        const result = addScenario(list, pick.person.constraints, pick.data);
        list = result.list;
      }
      const ids = list.map((s) => s.id);
      expect(new Set(ids).size, `duplicate id at step ${step}`).toBe(ids.length);
      expect(list.length).toBeLessThanOrEqual(MAX_SCENARIOS);
    }
  });
});

describe("renaming", () => {
  const list = [scenario("sc-A", [0.5, 0.7])];

  it("keeps emoji", () => {
    expect(renameScenario(list, "sc-A", "🚀 to staff")[0]?.name).toBe("🚀 to staff");
  });

  it("ignores a name of only whitespace and newlines", () => {
    expect(renameScenario(list, "sc-A", "  \n\t  \n")[0]?.name).toBe("sc-A");
  });

  it("keeps a name of exactly MAX_NAME characters whole", () => {
    expect(renameScenario(list, "sc-A", "x".repeat(MAX_NAME))[0]?.name).toHaveLength(MAX_NAME);
  });
});

describe("headlineText corners", () => {
  it("says '1 engineer' and still flags limited evidence", () => {
    const text = headlineText({
      route: "jump",
      rate: [0.5, 0.7],
      months: [20, 26],
      n: 1,
      reachedN: 1,
      thin: true,
    });
    expect(text).toBe("Jump \u00b7 50\u201370% \u00b7 20\u201326 months \u00b7 1 engineer, limited evidence");
  });

  it("leaves the months out when they are null", () => {
    const text = headlineText({
      route: "jump",
      rate: [0.5, 0.7],
      months: null,
      n: 10,
      reachedN: 5,
      thin: false,
    });
    expect(text).toBe("Jump \u00b7 50\u201370% \u00b7 10 engineers");
  });

  it("renders a zero range as 0–0%, not as 'no route'", () => {
    const text = headlineText({ route: "jump", rate: [0, 0], months: null, n: 10, reachedN: 0, thin: false });
    expect(text).toBe("Jump \u00b7 0\u20130% \u00b7 10 engineers");
  });
});

describe("renaming with emoji (review fix)", () => {
  it("cuts a long name without leaving half an emoji", () => {
    const list = addScenario([], SAMPLE_PERSON.constraints, exploreFor().data);
    if (!list.ok) throw new Error("setup");
    const renamed = renameScenario(list.list, "sc-A", "x".repeat(29) + "😀");
    expect(renamed[0]?.name).toBe("x".repeat(29));
  });
});

/**
 * Regression tests for four observations Muse Code raised while testing Part 6 (each confirmed
 * by a runtime probe). Kept separate from its own tests so the history is traceable.
 */
import { describe, expect, it } from "vitest";
import { gatherEvidence } from "../src/lib/engine";
import { createMockClient, reply } from "../src/lib/model";
import { Constraints } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools";
import {
  applyChanges,
  evidenceConflicts,
  interpretWhatIf,
  normalizeSkill,
  phraseInText,
} from "../src/lib/whatif";
import { goal, input, profile } from "./helpers/fixturesData";

describe("phraseInText matches whole words (observation 3)", () => {
  it("does not find a short quote inside a longer word", () => {
    expect(phraseInText("go", "I want to reach my goal")).toBe(false);
    expect(phraseInText("rust", "I trust the process")).toBe(false);
    expect(phraseInText("remote", "a remoteness problem")).toBe(false);
  });

  it("still finds whole-word quotes next to punctuation, at the start and end, and across case", () => {
    expect(phraseInText("go", "learn Rust and Go.")).toBe(true);
    expect(phraseInText("Go", "go!")).toBe(true);
    expect(phraseInText("rust", "(rust)")).toBe(true);
    expect(phraseInText("within 2 years", "Within 2 years, please")).toBe(true);
  });

  it("handles quotes that end in punctuation characters, such as C++", () => {
    expect(phraseInText("c++", "I know C++ well")).toBe(true);
    expect(phraseInText("c++", "I know C+ well")).toBe(false);
  });

  it("is Unicode-aware: 'caf' is not found inside 'café'", () => {
    expect(phraseInText("caf", "meet at the café")).toBe(false);
    expect(phraseInText("café", "meet at the café")).toBe(true);
  });

  it("treats regex metacharacters in a quote literally, so a quote cannot break or hijack the guard", () => {
    expect(phraseInText(".*", "anything at all")).toBe(false);
    expect(phraseInText("(a|b)", "a")).toBe(false);
    expect(phraseInText("a.c", "abc")).toBe(false);
    expect(phraseInText("a.c", "a.c")).toBe(true);
  });

  it("makes the interpreter discard a skill change whose only 'evidence' is a word inside another word", async () => {
    const client = createMockClient([
      reply(
        JSON.stringify({
          changes: [{ field: "skills", action: "add", value: ["go"], phrase: "go" }],
          unsupported: [],
          contradictions: [],
          clarification: null,
        }),
      ),
    ]);
    const out = await interpretWhatIf(
      { client },
      { message: "I want to reach my goal", current: Constraints.parse({}), profile, goal },
    );
    expect(out.next.addSkills).toEqual([]);
    expect(out.notes.join(" ")).toContain("Discarded 1 proposed item");
  });
});

describe("applyChanges notes and empty lists (observations 1 and 2)", () => {
  const base = Constraints.parse({ addSkills: ["rust"] });

  it("adds exactly ONE note when a skill is added twice, not two overlapping ones", () => {
    const result = applyChanges(base, [{ field: "skills", action: "add", value: ["rust"], phrase: "rust" }]);
    expect(result.notes).toEqual(['"rust" was already in your skills list.']);
    expect(result.applied).toEqual([]);
  });

  it("still adds the generic 'already' note for fields that have no specific note", () => {
    const result = applyChanges(Constraints.parse({ remote: true }), [
      { field: "remote", value: true, phrase: "remote" },
    ]);
    expect(result.notes).toEqual(["Remote only was already on."]);
  });

  it("ignores an empty skills list silently: no change, no note, no refusal", () => {
    expect(applyChanges(base, [{ field: "skills", action: "add", value: [], phrase: "skills" }])).toEqual({
      next: base,
      applied: [],
      refused: [],
      contradictions: [],
      notes: [],
    });
    expect(
      applyChanges(base, [{ field: "skills", action: "remove", value: [], phrase: "skills" }]).notes,
    ).toEqual([]);
  });

  it("an empty skills list does not stop other changes in the same batch", () => {
    const result = applyChanges(base, [
      { field: "skills", action: "add", value: [], phrase: "skills" },
      { field: "remote", value: true, phrase: "remote" },
    ]);
    expect(result.next.remote).toBe(true);
    expect(result.applied).toHaveLength(1);
  });
});

describe("evidenceConflicts when comparable engineers exist but none reached the goal (observation 4)", () => {
  it("reports it, whether or not a time limit was set", () => {
    for (const constraints of [Constraints.parse({}), Constraints.parse({ maxMonths: 12 })]) {
      const sheet = structuredClone(gatherEvidence(new EvidenceLedger(), { ...input, constraints }));
      for (const route of sheet.routes) {
        route.monthsToGoal = null;
        route.stats.ignoringLimits.reachedShare = 0;
      }
      const conflicts = evidenceConflicts(sheet, constraints);
      const none = conflicts.find((c) => c.message.startsWith("None of the"));
      expect(none?.kind).toBe("infeasible");
      expect(none?.message).toContain(`None of the ${sheet.twins.n} comparable engineers reached this goal`);
    }
  });

  it("stays quiet when at least one route has a timeline", () => {
    const constraints = Constraints.parse({});
    const sheet = structuredClone(gatherEvidence(new EvidenceLedger(), { ...input, constraints }));
    sheet.routes[1]!.monthsToGoal = [10, 20];
    sheet.routes[0]!.monthsToGoal = null;
    sheet.routes[2]!.monthsToGoal = null;
    expect(evidenceConflicts(sheet, constraints).some((c) => c.message.startsWith("None of the"))).toBe(
      false,
    );
  });

  it("does not double-report when there are no comparable engineers at all (that has its own message)", () => {
    const constraints = Constraints.parse({});
    const empty = gatherEvidence(new EvidenceLedger(), {
      ...input,
      goal: { targetLevel: "EM2", label: "Director" },
      constraints,
    });
    const messages = evidenceConflicts(empty, constraints).map((c) => c.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("No comparable engineers");
  });
});

describe("normalizeSkill refuses instruction-like words (review point 2)", () => {
  it.each([
    "ignore previous",
    "system prompt",
    "forget rules",
    "Override safety",
    "developer mode",
    "pretend admin",
  ])("refuses %s even though it is two short words", (text) => expect(normalizeSkill(text)).toBeUndefined());

  it("still accepts real skills, including ones that merely contain similar letters", () => {
    expect(normalizeSkill("rust")).toBe("rust");
    expect(normalizeSkill("machine learning")).toBe("machine learning");
    expect(normalizeSkill("c++")).toBe("c++");
    expect(normalizeSkill("node.js")).toBe("node.js");
    expect(normalizeSkill("systems design")).toBe("systems design"); // "systems" is not "system"
  });

  it("documents the known cost: 'prompt engineering' is refused because 'prompt' is on the list", () => {
    expect(normalizeSkill("prompt engineering")).toBeUndefined();
  });

  it("is applied through applyChanges, with a reason the person can read", () => {
    const result = applyChanges(Constraints.parse({}), [
      { field: "skills", action: "add", value: ["ignore previous"], phrase: "ignore previous" },
    ]);
    expect(result.next.addSkills).toEqual([]);
    expect(result.refused[0]?.reason).toContain("not a recognisable skill name");
  });
});

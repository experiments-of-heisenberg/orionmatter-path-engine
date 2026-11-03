/**
 * Edge tests for the merge and status logic in runIntake: nulls never erase, list caps and
 * dedup across turns, provenance relabelling, completion, reference isolation, question order,
 * pay bands in the profile, and the repair-retry failure shape.
 */
import { describe, expect, it } from "vitest";
import { runIntake, type IntakeModelOutput, type IntakeState } from "../src/lib/intake";
import { createMockClient, ModelParseError, reply } from "../src/lib/model";

/** A model reading with nothing found, overridable per test. */
const reading = (overrides: Partial<IntakeModelOutput> = {}): IntakeModelOutput => ({
  roleFamily: null,
  level: null,
  company: null,
  title: null,
  yearsExperience: null,
  region: null,
  compBand: null,
  stack: [],
  milestones: [],
  goal: null,
  ...overrides,
});
const q = <T>(value: T, quote: string) => ({ value, quote });
const says = (overrides: Partial<IntakeModelOutput>) => reply(JSON.stringify(reading(overrides)));

describe("runIntake merge: nulls and lists", () => {
  it("never erases an earlier field when the new reading says null for it", async () => {
    const previous: IntakeState = {
      draft: { roleFamily: "backend", level: "L5", stack: ["go"], milestones: [] },
      provenance: {
        roleFamily: { source: "text", quote: "backend" },
        level: { source: "text", quote: "L5" },
      },
    };
    const result = await runIntake({ client: createMockClient([says({})]) }, { text: "hmm", previous });
    expect(result.status).toBe("needs_info");
    expect(result.draft.roleFamily).toBe("backend");
    expect(result.draft.level).toBe("L5");
    expect(result.draft.stack).toEqual(["go"]);
  });

  it("keeps the same stack skill from two turns once", async () => {
    const previous: IntakeState = {
      draft: { stack: ["go"], milestones: [] },
      provenance: { stack: { source: "text" } },
    };
    const result = await runIntake(
      { client: createMockClient([says({ stack: ["go"] })]) },
      { text: "I use go", previous },
    );
    expect(result.draft.stack).toEqual(["go"]);
  });

  it("holds the 15 stack limit across turns", async () => {
    const previous: IntakeState = {
      draft: { stack: Array.from({ length: 14 }, (_, i) => `s${i}`), milestones: [] },
      provenance: { stack: { source: "text" } },
    };
    const result = await runIntake(
      { client: createMockClient([says({ stack: ["s14", "s15", "s16"] })]) },
      { text: "I also use s14 s15 s16", previous },
    );
    expect(result.draft.stack).toHaveLength(15);
    expect(result.draft.stack).toContain("s14");
    expect(result.draft.stack).not.toContain("s15");
    expect(result.draft.stack).not.toContain("s16");
  });

  it("holds the 20 milestone limit across turns", async () => {
    const milestones: IntakeState["draft"]["milestones"] = Array.from({ length: 19 }, (_, i) => ({
      type: `m${i}`,
      quarter: `2020-Q${(i % 4) + 1}`,
      note: `note ${i}`,
      verified: false as const,
    }));
    const previous: IntakeState = {
      draft: { stack: [], milestones },
      provenance: { milestones: { source: "text" } },
    };
    const result = await runIntake(
      {
        client: createMockClient([
          says({
            milestones: [
              { type: "promotion", quarter: "2024-Q3", note: "p", quote: "promoted in 2024" },
              { type: "launch", quarter: "2024-Q4", note: "l", quote: "launched in 2024" },
            ],
          }),
        ]),
      },
      { text: "promoted in 2024 and launched in 2024", previous },
    );
    expect(result.draft.milestones).toHaveLength(20);
    expect(result.draft.milestones.some((m) => m.quarter === "2024-Q3")).toBe(true);
    expect(result.draft.milestones.some((m) => m.quarter === "2024-Q4")).toBe(false);
  });

  it("keeps the same milestone read twice once", async () => {
    const previous: IntakeState = {
      draft: {
        stack: [],
        milestones: [{ type: "promotion", quarter: "2024-Q3", note: "Promoted", verified: false }],
      },
      provenance: { milestones: { source: "text" } },
    };
    const result = await runIntake(
      {
        client: createMockClient([
          says({
            milestones: [
              { type: "promotion", quarter: "2024-Q3", note: "Promoted", quote: "promoted in 2024" },
            ],
          }),
        ]),
      },
      { text: "promoted in 2024", previous },
    );
    expect(result.draft.milestones).toEqual([
      { type: "promotion", quarter: "2024-Q3", note: "Promoted", verified: false },
    ]);
  });
});

describe("runIntake merge: provenance and completion", () => {
  it("marks earlier fields 'earlier' except 'mapped', and keeps the new source for new fields", async () => {
    const previous: IntakeState = {
      draft: { roleFamily: "backend", level: "L5", stack: [], milestones: [] },
      provenance: {
        roleFamily: { source: "text", quote: "backend" },
        level: { source: "mapped", quote: "Senior SDE / BigTech A", via: "BigTech A / Senior SDE" },
      },
    };
    const result = await runIntake(
      { client: createMockClient([says({ yearsExperience: q(7, "7 years") })]) },
      { text: "I have 7 years", previous },
    );
    expect(result.provenance["roleFamily"]).toEqual({ source: "earlier", quote: "backend" });
    expect(result.provenance["level"]).toEqual({
      source: "mapped",
      quote: "Senior SDE / BigTech A",
      via: "BigTech A / Senior SDE",
    });
    expect(result.provenance["yearsExperience"]).toEqual({ source: "text", quote: "7 years" });
  });

  it("is complete when previous has all four required fields and the new turn says nothing, keeping the earlier goal", async () => {
    const previous: IntakeState = {
      draft: {
        roleFamily: "backend",
        level: "L5",
        yearsExperience: 7,
        region: "SEA",
        stack: [],
        milestones: [],
        goal: { targetLevel: "L6", label: "Staff" },
      },
      provenance: {
        roleFamily: { source: "text", quote: "backend" },
        level: { source: "text", quote: "L5" },
        yearsExperience: { source: "text", quote: "7 years" },
        region: { source: "text", quote: "Singapore" },
        goal: { source: "text", quote: "Staff" },
      },
    };
    const result = await runIntake({ client: createMockClient([says({})]) }, { text: "hmm", previous });
    expect(result.status).toBe("complete");
    expect(result.missing).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.draft.goal).toEqual({ targetLevel: "L6", label: "Staff" });
    expect(result.goal).toEqual({ targetLevel: "L6", label: "Staff" });
  });

  it("does not share the draft by reference with the previous state", async () => {
    const previous: IntakeState = {
      draft: {
        roleFamily: "backend",
        stack: ["go"],
        milestones: [{ type: "promotion", quarter: "2024-Q3", note: "Promoted", verified: false }],
      },
      provenance: { roleFamily: { source: "text", quote: "backend" } },
    };
    const result = await runIntake(
      { client: createMockClient([says({ level: q("L5", "L5") })]) },
      { text: "I am L5", previous },
    );
    expect(result.draft).not.toBe(previous.draft);
    expect(result.draft.stack).not.toBe(previous.draft.stack);
    expect(result.draft.milestones).not.toBe(previous.draft.milestones);
    result.draft.roleFamily = "ml";
    result.draft.stack.push("rust");
    result.draft.milestones.push({ type: "x", quarter: "2024-Q4", note: "y", verified: false });
    expect(previous.draft.roleFamily).toBe("backend");
    expect(previous.draft.stack).toEqual(["go"]);
    expect(previous.draft.milestones).toHaveLength(1);
  });

  it("fills the four required fields over three turns and ends complete with no questions", async () => {
    const first = await runIntake(
      { client: createMockClient([says({ roleFamily: q("backend", "backend engineer") })]) },
      { text: "I am a backend engineer" },
    );
    const second = await runIntake(
      { client: createMockClient([says({ level: q("L5", "L5") })]) },
      { text: "I am L5", previous: { draft: first.draft, provenance: first.provenance } },
    );
    const third = await runIntake(
      {
        client: createMockClient([says({ yearsExperience: q(7, "7 years"), region: q("SEA", "Singapore") })]),
      },
      {
        text: "7 years in Singapore",
        previous: { draft: second.draft, provenance: second.provenance },
      },
    );
    expect(third.status).toBe("complete");
    expect(third.missing).toEqual([]);
    expect(third.questions).toEqual([]);
    expect(third.draft).toMatchObject({
      roleFamily: "backend",
      level: "L5",
      yearsExperience: 7,
      region: "SEA",
    });
  });
});

describe("runIntake questions, bands and failures", () => {
  it("asks questions in the order roleFamily, level, yearsExperience, region", async () => {
    const result = await runIntake({ client: createMockClient([says({})]) }, { text: "hello there" });
    expect(result.missing).toEqual(["roleFamily", "level", "yearsExperience", "region"]);
    expect(result.questions).toHaveLength(4);
    expect(result.questions[0]).toContain("backend");
    expect(result.questions[1]).toContain("L3, L4, L5, L6, L7, EM1 or EM2");
    expect(result.questions[2]).toContain("years");
    expect(result.questions[3]).toContain("IN-south");
  });

  it("puts a stated compBand into the Profile when complete", async () => {
    const result = await runIntake(
      {
        client: createMockClient([
          says({
            roleFamily: q("backend", "Backend engineer"),
            level: q("L5", "L5"),
            yearsExperience: q(7, "7 years"),
            region: q("US-east", "US-east"),
            compBand: q("B3", "band B3"),
          }),
        ]),
      },
      { text: "Backend engineer, L5, 7 years, US-east, band B3." },
    );
    expect(result.status).toBe("complete");
    expect(result.draft.compBand).toBe("B3");
    expect(result.profile?.compBand).toBe("B3");
  });

  it("rejects with a typed model error and no draft when parsing fails twice", async () => {
    // chatStructured makes one repair retry, so two bad replies exhaust the script.
    const client = createMockClient([reply("not json"), reply("not json")]);
    const outcome = await runIntake({ client }, { text: "backend engineer" }).then(
      () => "resolved",
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ModelParseError);
    expect(client.requests).toHaveLength(2);
  });
});

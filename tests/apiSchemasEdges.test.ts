/**
 * Edge tests for the API request schemas: strictness, defaults, exact length
 * boundaries, the Intake draft round-trip, stripped keys inside Profile/Goal,
 * Constraints value types, and prototype-pollution shaped bodies.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  ExploreRequest,
  IntakeRequest,
  PlanRequest,
  PrivacyRequest,
  WhatIfRequest,
} from "../src/lib/api/schemas";
import { MAX_INTAKE_CHARS } from "../src/lib/intake";
import { person } from "./helpers/api";

const whatIfBase = { ...person, message: "within two years" };

describe("strict top-level keys and minimal bodies", () => {
  const cases: { name: string; schema: z.ZodType; body: Record<string, unknown> }[] = [
    { name: "IntakeRequest", schema: IntakeRequest, body: {} },
    { name: "PlanRequest", schema: PlanRequest, body: person },
    { name: "ExploreRequest", schema: ExploreRequest, body: person },
    { name: "WhatIfRequest", schema: WhatIfRequest, body: whatIfBase },
    { name: "PrivacyRequest", schema: PrivacyRequest, body: person },
  ];
  it.each(cases)(
    "$name accepts its minimal body and rejects an unknown top-level key",
    ({ schema, body }) => {
      expect(schema.safeParse(body).success).toBe(true);
      const withExtra = schema.safeParse({ ...body, hacker: true });
      expect(withExtra.success).toBe(false);
      if (withExtra.success) return;
      expect(withExtra.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    },
  );

  it("ExploreRequest is the same schema as PlanRequest", () => {
    expect(ExploreRequest).toBe(PlanRequest);
  });
});

describe("constraints defaults", () => {
  it("PlanRequest and ExploreRequest default constraints when omitted", () => {
    for (const schema of [PlanRequest, ExploreRequest]) {
      const parsed = schema.safeParse(person);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.constraints).toEqual({ riskTolerance: "medium", addSkills: [] });
    }
  });

  it("WhatIfRequest.current defaults when omitted", () => {
    const parsed = WhatIfRequest.safeParse(whatIfBase);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.current).toEqual({ riskTolerance: "medium", addSkills: [] });
  });

  it("an explicit constraints object is kept as given", () => {
    const parsed = PlanRequest.safeParse({ ...person, constraints: { maxMonths: 24 } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.constraints).toMatchObject({ maxMonths: 24, riskTolerance: "medium" });
  });
});

describe("WhatIfRequest boundaries", () => {
  it("accepts a 2000-character message and rejects 2001", () => {
    expect(WhatIfRequest.safeParse({ ...whatIfBase, message: "x".repeat(2000) }).success).toBe(true);
    expect(WhatIfRequest.safeParse({ ...whatIfBase, message: "x".repeat(2001) }).success).toBe(false);
  });

  it("accepts up to 3 history turns and rejects a fourth", () => {
    const turn = { question: "q", answer: "a" };
    expect(WhatIfRequest.safeParse({ ...whatIfBase, history: [turn, turn, turn] }).success).toBe(true);
    expect(WhatIfRequest.safeParse({ ...whatIfBase, history: [turn, turn, turn, turn] }).success).toBe(false);
  });

  it("caps history questions at 400 and answers at 600 characters", () => {
    const ok = { question: "q".repeat(400), answer: "a".repeat(600) };
    expect(WhatIfRequest.safeParse({ ...whatIfBase, history: [ok] }).success).toBe(true);
    expect(
      WhatIfRequest.safeParse({
        ...whatIfBase,
        history: [{ ...ok, question: "q".repeat(401) }],
      }).success,
    ).toBe(false);
    expect(
      WhatIfRequest.safeParse({ ...whatIfBase, history: [{ ...ok, answer: "a".repeat(601) }] }).success,
    ).toBe(false);
  });

  it("rejects an unknown key inside a history turn", () => {
    expect(
      WhatIfRequest.safeParse({ ...whatIfBase, history: [{ question: "q", answer: "a", extra: 1 }] }).success,
    ).toBe(false);
  });
});

describe("PrivacyRequest boundaries", () => {
  it("accepts 3500 text characters and rejects 3501", () => {
    expect(PrivacyRequest.safeParse({ ...person, text: "x".repeat(3500) }).success).toBe(true);
    expect(PrivacyRequest.safeParse({ ...person, text: "x".repeat(3501) }).success).toBe(false);
  });

  it("accepts a 40-character companyType and rejects 41", () => {
    expect(PrivacyRequest.safeParse({ ...person, companyType: "x".repeat(40) }).success).toBe(true);
    expect(PrivacyRequest.safeParse({ ...person, companyType: "x".repeat(41) }).success).toBe(false);
  });

  it("accepts k of 1 and 1000, and rejects 0, 1001, 2.5 and '5'", () => {
    for (const k of [1, 1000]) expect(PrivacyRequest.safeParse({ ...person, k }).success).toBe(true);
    for (const k of [0, 1001, 2.5, "5"])
      expect(PrivacyRequest.safeParse({ ...person, k }).success).toBe(false);
  });

  it("requires useModel to be a boolean", () => {
    expect(PrivacyRequest.safeParse({ ...person, useModel: true }).success).toBe(true);
    expect(PrivacyRequest.safeParse({ ...person, useModel: false }).success).toBe(true);
    for (const useModel of ["yes", 1, 0, null])
      expect(PrivacyRequest.safeParse({ ...person, useModel }).success).toBe(false);
  });
});

describe("IntakeRequest boundaries", () => {
  it("accepts MAX_INTAKE_CHARS + 1000 text characters and rejects one more", () => {
    expect(IntakeRequest.safeParse({ text: "x".repeat(MAX_INTAKE_CHARS + 1000) }).success).toBe(true);
    expect(IntakeRequest.safeParse({ text: "x".repeat(MAX_INTAKE_CHARS + 1001) }).success).toBe(false);
  });

  it("accepts an image data URL at the 5_800_000-character cap and rejects one over", () => {
    // The cap lives in schemas.ts as the private MAX_DATA_URL_CHARS; this pins its value.
    expect(IntakeRequest.safeParse({ imageDataUrl: `data:,${"A".repeat(5_800_000 - 6)}` }).success).toBe(
      true,
    );
    expect(IntakeRequest.safeParse({ imageDataUrl: `data:,${"A".repeat(5_800_000 - 5)}` }).success).toBe(
      false,
    );
  });

  it("a valid draft and provenance round-trips unchanged", () => {
    const previous = {
      draft: {
        roleFamily: "backend",
        level: "L5",
        yearsExperience: 7,
        region: "IN-south",
        compBand: "B4",
        stack: ["go"],
        milestones: [{ type: "launch", quarter: "2024-Q1", note: "shipped", verified: false }],
        goal: { targetLevel: "L6", label: "Staff Engineer" },
      },
      provenance: {
        level: { source: "text", quote: "I am L5" },
        region: { source: "earlier" },
      },
    };
    const parsed = IntakeRequest.safeParse({ previous });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.previous).toEqual(previous);
  });

  it("rejects a draft with an unknown key: the draft schema is strict", () => {
    const previous = {
      draft: { stack: ["go"], milestones: [], bogus: 1 },
      provenance: {},
    };
    expect(IntakeRequest.safeParse({ previous }).success).toBe(false);
    expect(IntakeRequest.safeParse({ previous: { ...previous, bogus: 1 } }).success).toBe(false);
  });

  it("accepts each of the four provenance sources and rejects anything else", () => {
    for (const source of ["text", "image", "earlier", "mapped"]) {
      const parsed = IntakeRequest.safeParse({
        previous: { draft: { stack: [], milestones: [] }, provenance: { level: { source } } },
      });
      expect(parsed.success).toBe(true);
    }
    expect(
      IntakeRequest.safeParse({
        previous: {
          draft: { stack: [], milestones: [] },
          provenance: { level: { source: "hearsay" } },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a stack over 15 items, a verified milestone, and a level over 10 characters", () => {
    const base = { draft: { stack: ["go"], milestones: [] }, provenance: {} };
    expect(IntakeRequest.safeParse({ previous: base }).success).toBe(true);
    expect(
      IntakeRequest.safeParse({
        previous: { ...base, draft: { ...base.draft, stack: Array.from({ length: 16 }, () => "go") } },
      }).success,
    ).toBe(false);
    expect(
      IntakeRequest.safeParse({
        previous: {
          ...base,
          draft: {
            ...base.draft,
            milestones: [{ type: "t", quarter: "2024-Q1", note: "n", verified: true }],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      IntakeRequest.safeParse({
        previous: { ...base, draft: { ...base.draft, level: "L".repeat(11) } },
      }).success,
    ).toBe(false);
    expect(
      IntakeRequest.safeParse({
        previous: { ...base, draft: { ...base.draft, level: "L".repeat(10) } },
      }).success,
    ).toBe(true);
  });

  it("states: provenance has no cap on the number of keys, so a record with many keys is accepted", () => {
    const many: Record<string, { source: string }> = {};
    for (let i = 0; i < 1000; i++) many[`field${i}`] = { source: "text" };
    const parsed = IntakeRequest.safeParse({
      previous: { draft: { stack: [], milestones: [] }, provenance: many },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("unknown keys inside Profile and Goal are stripped, not rejected", () => {
  it("PlanRequest accepts the body and drops the unknown keys", () => {
    const parsed = PlanRequest.safeParse({
      ...person,
      profile: { ...person.profile, hacker: true },
      goal: { ...person.goal, hacker: true },
    });
    // Profile and Goal come from src/lib/schemas.ts as plain (non-strict) Zod objects,
    // so unknown keys are stripped by default instead of failing validation.
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect("hacker" in parsed.data.profile).toBe(false);
    expect("hacker" in parsed.data.goal).toBe(false);
    expect(parsed.data.profile).toEqual({
      roleFamily: "backend",
      level: "L5",
      yearsExperience: 7,
      stack: ["go", "kubernetes"],
      region: "IN-south",
      milestones: [],
    });
  });
});

describe("Constraints value types inside requests", () => {
  it("rejects maxMonths of 1.5, 0, 241 and '24', and accepts 1 and 240", () => {
    for (const maxMonths of [1.5, 0, 241, "24"])
      expect(PlanRequest.safeParse({ ...person, constraints: { maxMonths } }).success).toBe(false);
    for (const maxMonths of [1, 240])
      expect(PlanRequest.safeParse({ ...person, constraints: { maxMonths } }).success).toBe(true);
  });

  it("rejects minCompBand 'B6' and accepts 'B5'", () => {
    expect(PlanRequest.safeParse({ ...person, constraints: { minCompBand: "B6" } }).success).toBe(false);
    expect(PlanRequest.safeParse({ ...person, constraints: { minCompBand: "B5" } }).success).toBe(true);
  });

  it("states: Constraints sets no cap on addSkills, so a long list is accepted; entries must be strings", () => {
    expect(
      PlanRequest.safeParse({
        ...person,
        constraints: { addSkills: Array.from({ length: 100 }, () => "go") },
      }).success,
    ).toBe(true);
    expect(PlanRequest.safeParse({ ...person, constraints: { addSkills: ["go", 5] } }).success).toBe(false);
  });
});

describe("prototype-pollution shaped bodies", () => {
  it("__proto__ and constructor payloads are rejected or ignored without polluting Object.prototype", () => {
    // Bodies arrive through JSON.parse, which keeps __proto__ as an own data
    // property; the object literal form would behave differently, so parse text.
    const protoBefore = Object.getOwnPropertyNames(Object.prototype).join(",");
    const topProto: unknown = JSON.parse('{"__proto__": {"x": 1}}');
    const topCtor: unknown = JSON.parse('{"constructor": {"prototype": {"y": 1}}}');
    expect(IntakeRequest.safeParse(topProto).success).toBe(false);
    expect(PlanRequest.safeParse(topProto).success).toBe(false);
    expect(IntakeRequest.safeParse(topCtor).success).toBe(false);

    // Inside Profile (non-strict) the keys are stripped, never merged.
    const nested: unknown = JSON.parse(
      `{"profile": {"roleFamily": "backend", "level": "L5", "yearsExperience": 7, "stack": [], "region": "r", "__proto__": {"x": 2}, "constructor": {"prototype": {"y": 2}}}, "goal": {"targetLevel": "L6", "label": "g"}}`,
    );
    const parsed = PlanRequest.safeParse(nested);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect("x" in parsed.data.profile).toBe(false);

    expect(Object.getOwnPropertyNames(Object.prototype).join(",")).toBe(protoBefore);
    expect((Object.prototype as Record<string, unknown>)["x"]).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)["y"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });
});

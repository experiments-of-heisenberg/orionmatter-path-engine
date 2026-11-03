/**
 * Tests for the What-if interpreter's schemas. The model is untrusted, so every field of its
 * output must accept exactly the values code knows how to handle and reject everything else.
 */
import { describe, expect, it } from "vitest";
import {
  ChangeField,
  Clarification,
  Contradiction,
  ModelChange,
  ModelOutput,
} from "../src/lib/whatif/schemas";

describe("ChangeField", () => {
  it("lists exactly the six constraint fields the interpreter can change", () => {
    expect([...ChangeField.options]).toEqual([
      "remote",
      "noRelocation",
      "minCompBand",
      "maxMonths",
      "riskTolerance",
      "skills",
    ]);
  });

  it("rejects anything else", () => {
    for (const field of ["other", "addSkills", "REMOTE", "", 42]) {
      expect(ChangeField.safeParse(field).success).toBe(false);
    }
  });
});

describe("ModelChange: each field accepts only its own value type", () => {
  it.each(["remote", "noRelocation"] as const)("%s accepts booleans and rejects strings", (field) => {
    expect(ModelChange.safeParse({ field, value: true, phrase: "x" }).success).toBe(true);
    expect(ModelChange.safeParse({ field, value: false, phrase: "x" }).success).toBe(true);
    for (const value of ["true", "yes", 1, 0, null]) {
      expect(ModelChange.safeParse({ field, value, phrase: "x" }).success).toBe(false);
    }
  });

  it("minCompBand accepts B1 to B5 and null", () => {
    for (const value of ["B1", "B2", "B3", "B4", "B5", null]) {
      expect(ModelChange.safeParse({ field: "minCompBand", value, phrase: "x" }).success).toBe(true);
    }
  });

  it('minCompBand rejects "B6", "b3" and numbers', () => {
    for (const value of ["B6", "b3", "B0", "B 4", 3, 4.5, true]) {
      expect(ModelChange.safeParse({ field: "minCompBand", value, phrase: "x" }).success).toBe(false);
    }
  });

  it("maxMonths accepts any integer including null and negatives", () => {
    for (const value of [6, 24, 120, 0, -3, 9999, null]) {
      expect(ModelChange.safeParse({ field: "maxMonths", value, phrase: "x" }).success).toBe(true);
    }
  });

  it("maxMonths rejects non-integers and strings (range checking happens in code, not here)", () => {
    for (const value of [1.5, Number.NaN, "24", "two years", true]) {
      expect(ModelChange.safeParse({ field: "maxMonths", value, phrase: "x" }).success).toBe(false);
    }
  });

  it("riskTolerance accepts low, medium and high only", () => {
    for (const value of ["low", "medium", "high"]) {
      expect(ModelChange.safeParse({ field: "riskTolerance", value, phrase: "x" }).success).toBe(true);
    }
    for (const value of ["Low", "HIGH", "safe", "risky", "", 0, null, true]) {
      expect(ModelChange.safeParse({ field: "riskTolerance", value, phrase: "x" }).success).toBe(false);
    }
  });

  it('skills requires action "add" or "remove"', () => {
    for (const action of ["add", "remove"]) {
      expect(ModelChange.safeParse({ field: "skills", action, value: ["rust"], phrase: "x" }).success).toBe(
        true,
      );
    }
    for (const action of ["learn", "forget", "ADD", "", null, 1]) {
      expect(ModelChange.safeParse({ field: "skills", action, value: ["rust"], phrase: "x" }).success).toBe(
        false,
      );
    }
    expect(ModelChange.safeParse({ field: "skills", value: ["rust"], phrase: "x" }).success).toBe(false);
  });

  it("skills accepts a string array of at most 8 items, each at most 40 characters", () => {
    expect(
      ModelChange.safeParse({ field: "skills", action: "add", value: ["rust", "go"], phrase: "x" }).success,
    ).toBe(true);
    expect(
      ModelChange.safeParse({
        field: "skills",
        action: "add",
        value: Array.from({ length: 8 }, (_, i) => `s${i}`),
        phrase: "x",
      }).success,
    ).toBe(true);
    expect(
      ModelChange.safeParse({
        field: "skills",
        action: "add",
        value: ["x".repeat(40)],
        phrase: "x",
      }).success,
    ).toBe(true);
    expect(
      ModelChange.safeParse({
        field: "skills",
        action: "add",
        value: Array.from({ length: 9 }, (_, i) => `s${i}`),
        phrase: "x",
      }).success,
    ).toBe(false);
    expect(
      ModelChange.safeParse({
        field: "skills",
        action: "add",
        value: ["x".repeat(41)],
        phrase: "x",
      }).success,
    ).toBe(false);
    expect(
      ModelChange.safeParse({ field: "skills", action: "add", value: ["rust", 42], phrase: "x" }).success,
    ).toBe(false);
    expect(
      ModelChange.safeParse({ field: "skills", action: "add", value: "rust", phrase: "x" }).success,
    ).toBe(false);
  });

  it("rejects an unknown field name", () => {
    expect(ModelChange.safeParse({ field: "addSkills", value: ["rust"], phrase: "x" }).success).toBe(false);
    expect(ModelChange.safeParse({ field: "other", value: true, phrase: "x" }).success).toBe(false);
    expect(ModelChange.safeParse({ field: "REMOTE", value: true, phrase: "x" }).success).toBe(false);
    expect(ModelChange.safeParse({ value: true, phrase: "x" }).success).toBe(false);
  });

  it("rejects a missing phrase, and a phrase over 200 characters", () => {
    expect(ModelChange.safeParse({ field: "remote", value: true }).success).toBe(false);
    expect(ModelChange.safeParse({ field: "remote", value: true, phrase: 42 }).success).toBe(false);
    expect(ModelChange.safeParse({ field: "remote", value: true, phrase: "x".repeat(200) }).success).toBe(
      true,
    );
    expect(ModelChange.safeParse({ field: "remote", value: true, phrase: "x".repeat(201) }).success).toBe(
      false,
    );
  });
});

describe("Clarification", () => {
  it("requires a non-empty question of at most 250 characters", () => {
    expect(Clarification.safeParse({ question: "Which band?", about: "minCompBand" }).success).toBe(true);
    expect(Clarification.safeParse({ about: "minCompBand" }).success).toBe(false);
    expect(Clarification.safeParse({ question: "", about: "minCompBand" }).success).toBe(false);
    expect(Clarification.safeParse({ question: "x".repeat(250), about: "minCompBand" }).success).toBe(true);
    expect(Clarification.safeParse({ question: "x".repeat(251), about: "minCompBand" }).success).toBe(false);
  });

  it('accepts any ChangeField or "other" as "about", and nothing else', () => {
    for (const about of [...ChangeField.options, "other"]) {
      expect(Clarification.safeParse({ question: "q?", about }).success).toBe(true);
    }
    for (const about of ["REMOTE", "addSkills", "", null, 42]) {
      expect(Clarification.safeParse({ question: "q?", about }).success).toBe(false);
    }
    expect(Clarification.safeParse({ question: "q?" }).success).toBe(false);
  });

  it("leaves options optional, with at most 4 entries of at most 60 characters", () => {
    expect(Clarification.safeParse({ question: "q?", about: "remote", options: ["yes", "no"] }).success).toBe(
      true,
    );
    expect(
      Clarification.safeParse({ question: "q?", about: "remote", options: ["a", "b", "c", "d"] }).success,
    ).toBe(true);
    expect(
      Clarification.safeParse({
        question: "q?",
        about: "remote",
        options: ["x".repeat(60)],
      }).success,
    ).toBe(true);
    expect(
      Clarification.safeParse({ question: "q?", about: "remote", options: ["a", "b", "c", "d", "e"] })
        .success,
    ).toBe(false);
    expect(
      Clarification.safeParse({
        question: "q?",
        about: "remote",
        options: ["x".repeat(61)],
      }).success,
    ).toBe(false);
    expect(Clarification.safeParse({ question: "q?", about: "remote", options: ["ok", 42] }).success).toBe(
      false,
    );
  });
});

describe("Contradiction", () => {
  it("requires 1 to 4 fields from ChangeField", () => {
    expect(Contradiction.safeParse({ fields: ["remote"], phrases: ["a"], description: "d" }).success).toBe(
      true,
    );
    expect(
      Contradiction.safeParse({
        fields: ["remote", "noRelocation", "maxMonths", "skills"],
        phrases: ["a"],
        description: "d",
      }).success,
    ).toBe(true);
    expect(Contradiction.safeParse({ fields: [], phrases: ["a"], description: "d" }).success).toBe(false);
    expect(
      Contradiction.safeParse({
        fields: ["remote", "remote", "remote", "remote", "remote"],
        phrases: ["a"],
        description: "d",
      }).success,
    ).toBe(false);
    expect(Contradiction.safeParse({ fields: ["other"], phrases: ["a"], description: "d" }).success).toBe(
      false,
    );
  });

  it("requires 1 to 4 phrases", () => {
    expect(
      Contradiction.safeParse({ fields: ["remote"], phrases: ["a", "b"], description: "d" }).success,
    ).toBe(true);
    expect(Contradiction.safeParse({ fields: ["remote"], phrases: [], description: "d" }).success).toBe(
      false,
    );
    expect(
      Contradiction.safeParse({
        fields: ["remote"],
        phrases: ["a", "b", "c", "d", "e"],
        description: "d",
      }).success,
    ).toBe(false);
  });
});

describe("ModelOutput", () => {
  it("accepts the empty output", () => {
    expect(
      ModelOutput.safeParse({ changes: [], unsupported: [], contradictions: [], clarification: null })
        .success,
    ).toBe(true);
  });

  it("rejects more than 8 changes, 5 unsupported items or 3 contradictions", () => {
    const change = { field: "remote", value: true, phrase: "x" };
    const unsupported = { phrase: "x", reason: "r" };
    const contradiction = { fields: ["remote"], phrases: ["a"], description: "d" };
    expect(
      ModelOutput.safeParse({
        changes: Array.from({ length: 8 }, () => change),
        unsupported: [],
        contradictions: [],
        clarification: null,
      }).success,
    ).toBe(true);
    expect(
      ModelOutput.safeParse({
        changes: Array.from({ length: 9 }, () => change),
        unsupported: [],
        contradictions: [],
        clarification: null,
      }).success,
    ).toBe(false);
    expect(
      ModelOutput.safeParse({
        changes: [],
        unsupported: Array.from({ length: 6 }, () => unsupported),
        contradictions: [],
        clarification: null,
      }).success,
    ).toBe(false);
    expect(
      ModelOutput.safeParse({
        changes: [],
        unsupported: [],
        contradictions: Array.from({ length: 4 }, () => contradiction),
        clarification: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing clarification key: it must be explicit null", () => {
    expect(ModelOutput.safeParse({ changes: [], unsupported: [], contradictions: [] }).success).toBe(false);
  });
});

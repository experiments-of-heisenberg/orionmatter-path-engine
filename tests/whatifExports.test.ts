/**
 * Tests for the What-if module's public entry point. Callers import from here, so this pins
 * the exported names and the constant values other code and tests rely on.
 */
import { describe, expect, it } from "vitest";
import * as whatif from "../src/lib/whatif";
import {
  applyChanges,
  evidenceConflicts,
  interpretWhatIf,
  MAX_MESSAGE_CHARS,
  MAX_SKILLS,
  MONTHS_RANGE,
  normalizeSkill,
  phraseInText,
  WhatIfInputError,
} from "../src/lib/whatif";

describe("the public entry point", () => {
  it("exports the interpreter's functions and constants", () => {
    expect(typeof applyChanges).toBe("function");
    expect(typeof evidenceConflicts).toBe("function");
    expect(typeof interpretWhatIf).toBe("function");
    expect(typeof normalizeSkill).toBe("function");
    expect(typeof phraseInText).toBe("function");
    expect(typeof WhatIfInputError).toBe("function");
    expect(typeof MAX_MESSAGE_CHARS).toBe("number");
    expect(typeof MAX_SKILLS).toBe("number");
    expect(typeof MONTHS_RANGE).toBe("object");
    // Every name above must come from the index, not from a deep import.
    for (const name of [
      "applyChanges",
      "evidenceConflicts",
      "interpretWhatIf",
      "normalizeSkill",
      "phraseInText",
      "MAX_MESSAGE_CHARS",
      "MAX_SKILLS",
      "MONTHS_RANGE",
      "WhatIfInputError",
    ] as const) {
      expect(whatif[name]).toBeDefined();
    }
  });

  it("pins the constant values", () => {
    expect(MONTHS_RANGE).toEqual({ min: 6, max: 120 });
    expect(MAX_MESSAGE_CHARS).toBe(500);
    expect(MAX_SKILLS).toBe(5);
  });
});

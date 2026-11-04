/** Intake edges: odd form values, seeded follow-ups against the server schema, files, names, sources. */
import { describe, expect, it } from "vitest";
import { IntakeRequest } from "../src/lib/api/schemas";
import type { Draft, IntakeResult, Provenance } from "../src/lib/intake";
import {
  EMPTY_FORM,
  checkImageFile,
  editedKeys,
  fieldSource,
  formFromDraft,
  personFromForm,
  previousFrom,
  provenanceText,
  withStackAdded,
  type FormValues,
} from "../src/ui/intake";
import { partialReading, read } from "./helpers/intake";

const filled: FormValues = {
  ...EMPTY_FORM,
  roleFamily: "backend",
  level: "L5",
  years: "7",
  region: "IN-south",
  goalLevel: "L6",
  goalLabel: "Staff Engineer",
  stack: ["go", "kubernetes"],
};

/** A small seeded generator, so the 30 follow-ups below are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("personFromForm with odd values", () => {
  it("states: exponent and hex years are accepted as numbers, padded years are trimmed", () => {
    expect(personFromForm({ ...filled, years: "7e0" })).toMatchObject({
      ok: true,
      person: { profile: { yearsExperience: 7 } },
    });
    expect(personFromForm({ ...filled, years: "0x10" })).toMatchObject({
      ok: true,
      person: { profile: { yearsExperience: 16 } },
    });
    expect(personFromForm({ ...filled, years: " 7 " })).toMatchObject({
      ok: true,
      person: { profile: { yearsExperience: 7 } },
    });
  });

  it("refuses comma decimals, non-ASCII digits and Infinity; accepts -0 as 0", () => {
    for (const years of ["7,5", "٧", "Infinity"]) {
      const out = personFromForm({ ...filled, years });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.problems.join(" ")).toContain("Years of experience");
    }
    // "٧" is the Arabic-Indic digit seven: Number() does not read it, so it fails like text.
    const zero = personFromForm({ ...filled, years: "-0" });
    expect(zero.ok).toBe(true);
    // "-0" is accepted and stored as negative zero (Object.is distinguishes it from 0).
    if (zero.ok) expect(Object.is(zero.person.profile.yearsExperience, -0)).toBe(true);
  });

  it("states: level and region match exactly (lower-case and padded values fail)", () => {
    expect(personFromForm({ ...filled, level: "l5" }).ok).toBe(false);
    expect(personFromForm({ ...filled, region: " IN-south " }).ok).toBe(false);
  });

  it("states: a markup goal label is kept verbatim (escaping happens at render), duplicates kept, lower-case band dropped", () => {
    const markup = personFromForm({ ...filled, goalLabel: "<b>boss</b>" });
    expect(markup).toMatchObject({ ok: true, person: { goal: { label: "<b>boss</b>" } } });
    // personFromForm does not dedupe: case variants of one technology are all kept.
    const dupes = personFromForm({ ...filled, stack: ["Go", "go", "GO"] });
    expect(dupes).toMatchObject({ ok: true, person: { profile: { stack: ["Go", "go", "GO"] } } });
    // A lower-case band is not an error: the person is accepted and the band silently dropped.
    const band = personFromForm({ ...filled, compBand: "b4" });
    expect(band.ok).toBe(true);
    if (band.ok) expect("compBand" in band.person.profile).toBe(false);
  });
});

describe("previousFrom clips and stays inside the server schema", () => {
  it("keeps half years, clips long lists and labels, drops a bad band", async () => {
    const first = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
    const form: FormValues = {
      ...formFromDraft(first.draft),
      years: "7.5",
      stack: Array.from({ length: 30 }, (_, i) => `tool${i}`),
      milestones: Array.from({ length: 30 }, () => ({
        type: "launch",
        quarter: "2024Q1",
        note: "shipped",
        verified: false as const,
      })),
      goalLevel: "L6",
      goalLabel: "x".repeat(90),
      compBand: "B9",
    };
    const previous = previousFrom(first, form);
    expect(previous.draft.yearsExperience).toBe(7.5);
    expect(previous.draft.stack).toHaveLength(15);
    expect(previous.draft.milestones).toHaveLength(20);
    expect(previous.draft.goal?.label).toHaveLength(60);
    expect("compBand" in previous.draft).toBe(false);
    expect(IntakeRequest.parse({ previous }).previous?.draft.stack).toHaveLength(15);
  });

  it("30 seeded forms all produce a `previous` the server schema accepts", async () => {
    const first = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
    const random = rng(1407);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const roles = ["backend", "ml", "wizard", ""];
    const levels = ["L4", "L5", "l5", "L9", ""];
    const regions = ["SEA", "IN-south", " Mars ", ""];
    const years = ["3", "7.5", "7.25", "abc", "", "41", "-0"];
    const goals = ["L5", "L6", "CEO", ""];
    const bands = ["B2", "b4", "B9", ""];
    for (let i = 0; i < 30; i++) {
      const stackLength = Math.floor(random() * 20);
      const form: FormValues = {
        ...EMPTY_FORM,
        roleFamily: pick(roles),
        level: pick(levels),
        years: pick(years),
        region: pick(regions),
        stack: Array.from({ length: stackLength }, (_, j) => `tool${i}-${j}`),
        goalLevel: pick(goals),
        goalLabel: random() < 0.5 ? "x".repeat(90) : "Senior Engineer",
        compBand: pick(bands),
        milestones: [],
      };
      const previous = previousFrom(first, form);
      expect(() => IntakeRequest.parse({ previous })).not.toThrow();
    }
  });
});

describe("editedKeys notices small changes", () => {
  it("only the goal label, only the stack order, only the milestones", () => {
    expect([...editedKeys(filled, { ...filled, goalLabel: "Other" })]).toEqual(["goal"]);
    // Order counts: the same technologies in another order mark the stack as changed.
    expect([...editedKeys({ ...filled, stack: ["a", "b"] }, { ...filled, stack: ["b", "a"] })]).toEqual([
      "stack",
    ]);
    const milestone = { type: "launch", quarter: "2024Q1", note: "shipped", verified: false as const };
    expect([...editedKeys(filled, { ...filled, milestones: [milestone] })]).toEqual(["milestones"]);
  });
});

describe("checkImageFile at the edges", () => {
  it("exactly 4 MB passes, one byte more fails with the size in words", () => {
    expect(checkImageFile({ type: "image/png", size: 4 * 1024 * 1024 })).toEqual({ ok: true });
    const over = checkImageFile({ type: "image/png", size: 4 * 1024 * 1024 + 1 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain("4.0 MB");
  });

  it("states: the type matches exactly, so upper-case, empty and text types all fail (the file name is never read)", () => {
    for (const type of ["IMAGE/PNG", "", "text/plain"]) {
      expect(checkImageFile({ type, size: 100 })).toEqual({
        ok: false,
        message: "Please choose a PNG, JPEG or WebP picture.",
      });
    }
    // A file named ".png" with type text/plain fails: only the MIME type decides.
  });
});

describe("withStackAdded with odd names", () => {
  it("40 emoji units fit whole; a pair that would split is dropped instead", () => {
    const forty = withStackAdded({ ...filled, stack: [] }, "🎉".repeat(20));
    expect(forty.stack[0]?.length).toBe(40);
    // 39 units plus an emoji would cut the pair at 40, so the clip drops the pair: 39 units, no lone half.
    const split = withStackAdded({ ...filled, stack: [] }, `${"a".repeat(39)}🎉`);
    expect(split.stack[0]).toBe("a".repeat(39));
  });

  it("whitespace-only and existing names in another case leave the form untouched", () => {
    expect(withStackAdded(filled, "   ")).toBe(filled);
    const form = { ...filled, stack: ["Go"] };
    expect(withStackAdded(form, "go")).toBe(form);
  });
});

describe("provenance words for every source", () => {
  const cases: [Provenance | undefined, string][] = [
    [undefined, "Entered by you"],
    [{ source: "text" }, "From your words"],
    [{ source: "text", quote: "7 years" }, "From your words: “7 years”"],
    [{ source: "image" }, "Read from your screenshot. Please check it."],
    [{ source: "image", quote: "ignored" }, "Read from your screenshot. Please check it."],
    [{ source: "earlier" }, "From your earlier answer"],
    [{ source: "mapped" }, "Worked out from what you wrote"],
    [{ source: "mapped", via: "BigTech A / Senior SDE" }, "Worked out from BigTech A / Senior SDE"],
  ];

  it("provenanceText words each source with and without quote and via", () => {
    for (const [provenance, words] of cases) expect(provenanceText(provenance)).toBe(words);
  });

  it("fieldSource says Entered by you for edited fields whatever the draft claimed", () => {
    const provenance: Record<string, Provenance> = {
      level: { source: "image" },
      goal: { source: "mapped", via: "L6 / Staff" },
    };
    expect(fieldSource("level", provenance, new Set())).toBe("Read from your screenshot. Please check it.");
    expect(fieldSource("goal", provenance, new Set())).toBe("Worked out from L6 / Staff");
    expect(fieldSource("level", provenance, new Set(["level"]))).toBe("Entered by you");
    expect(fieldSource("region", provenance, new Set())).toBe("Entered by you");
  });

  it("a read draft round-trips through the form with its provenance keys intact", async () => {
    const result: IntakeResult = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
    const form = formFromDraft(result.draft);
    expect(editedKeys(form, form).size).toBe(0);
    const draft: Draft = previousFrom(result, form).draft;
    expect(draft.roleFamily).toBe("backend");
  });
});

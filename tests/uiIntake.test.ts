/** The "Your story" logic: input checks, provenance words, the form, confirming, and agreement with the server. */
import { describe, expect, it } from "vitest";
import { LEVELS, MAX_IMAGE_BYTES, MAX_INTAKE_CHARS, REGIONS } from "../src/lib/intake";
import { Goal, Profile } from "../src/lib/schemas";
import {
  CROP_WARNING,
  EMPTY_FORM,
  GOAL_LABEL,
  IMAGE_TYPES,
  LEVEL_OPTIONS,
  MAX_IMAGE,
  MAX_INTAKE,
  REGION_OPTIONS,
  ROLE_OPTIONS,
  checkImageFile,
  checkIntakeInput,
  editedKeys,
  fieldSource,
  formFromDraft,
  intakeBody,
  missingFields,
  personFromForm,
  previousFrom,
  provenanceText,
  withGoalLevel,
  withStackAdded,
  withStackRemoved,
  type FormValues,
} from "../src/ui/intake";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { STORY_TEXT, fullReading, partialReading, read, yearsReading } from "./helpers/intake";

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

describe("agreement with the server", () => {
  it("limits, the level ladder, the regions and the role families are the server's", () => {
    expect(MAX_INTAKE).toBe(MAX_INTAKE_CHARS);
    expect(MAX_IMAGE).toBe(MAX_IMAGE_BYTES);
    expect([...LEVEL_OPTIONS]).toEqual([...LEVELS]);
    expect([...REGION_OPTIONS].sort()).toEqual([...REGIONS].sort());
    expect(ROLE_OPTIONS.sort()).toEqual(["backend", "embedded", "frontend", "ml", "platform", "sre"]);
    for (const level of LEVEL_OPTIONS) expect(GOAL_LABEL[level]?.length).toBeGreaterThan(2);
  });
});

describe("checking input before it is sent", () => {
  it("needs words or a picture; trims and strips control characters; refuses over-long text with the count", () => {
    expect(checkIntakeInput({ text: "  hi\u0000 there ", image: undefined })).toEqual({
      ok: true,
      text: "hi there",
    });
    expect(checkIntakeInput({ text: "", image: undefined }).ok).toBe(false);
    expect(checkIntakeInput({ text: "\u0000", image: undefined }).ok).toBe(false);
    expect(checkIntakeInput({ text: "", image: { name: "a.png", dataUrl: "data:" } })).toEqual({
      ok: true,
      text: "",
    });
    expect(checkIntakeInput({ text: "x".repeat(MAX_INTAKE), image: undefined }).ok).toBe(true);
    const over = checkIntakeInput({ text: "x".repeat(MAX_INTAKE + 1), image: undefined });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain(`${MAX_INTAKE + 1} characters`);
  });

  it("accepts PNG, JPEG and WebP up to 4 MB, and says why for anything else", () => {
    for (const type of IMAGE_TYPES) expect(checkImageFile({ type, size: 1000 }).ok).toBe(true);
    expect(checkImageFile({ type: "image/png", size: MAX_IMAGE }).ok).toBe(true);
    const big = checkImageFile({ type: "image/png", size: MAX_IMAGE + 1 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toContain("4 MB");
    expect(checkImageFile({ type: "image/gif", size: 10 }).ok).toBe(false);
    expect(checkImageFile({ type: "application/pdf", size: 10 }).ok).toBe(false);
    expect(checkImageFile({ type: "image/png", size: 0 })).toEqual({
      ok: false,
      message: "That file is empty.",
    });
  });

  it("the crop warning says what the model sees and what is removed from typed text", () => {
    expect(CROP_WARNING).toContain("Crop your screenshot");
    expect(CROP_WARNING).toContain("exactly as it is");
    expect(CROP_WARNING).toContain("emails, phone numbers and links removed");
  });
});

describe("provenance words", () => {
  it("quote the person's words, flag screenshots for checking, and name a mapping", () => {
    expect(provenanceText({ source: "text", quote: "7 years" })).toBe("From your words: \u201c7 years\u201d");
    expect(provenanceText({ source: "text" })).toBe("From your words");
    expect(provenanceText({ source: "image" })).toBe("Read from your screenshot. Please check it.");
    expect(provenanceText({ source: "earlier" })).toBe("From your earlier answer");
    expect(provenanceText({ source: "mapped", via: "BigTech A / Senior SDE" })).toBe(
      "Worked out from BigTech A / Senior SDE",
    );
    expect(provenanceText({ source: "mapped" })).toBe("Worked out from what you wrote");
    expect(provenanceText(undefined)).toBe("Entered by you");
  });
  it("a field the person changed says so, whatever the draft said", () => {
    const prov = { level: { source: "text" as const, quote: "L5" } };
    expect(fieldSource("level", prov, new Set())).toBe("From your words: \u201cL5\u201d");
    expect(fieldSource("level", prov, new Set(["level"]))).toBe("Entered by you");
    expect(fieldSource("region", prov, new Set())).toBe("Entered by you");
  });
});

describe("a real reading becomes a form", () => {
  it("a complete reading fills every field and confirms into the same person the sample uses", async () => {
    const result = await read({ text: STORY_TEXT }, [fullReading]);
    const form = formFromDraft(result.draft);
    expect(form).toMatchObject({
      roleFamily: "backend",
      level: "L5",
      years: "7",
      region: "IN-south",
      goalLevel: "L6",
      goalLabel: "Staff Engineer",
    });
    expect(form.stack).toEqual(["go", "kubernetes"]);
    expect(missingFields(form)).toEqual([]);
    const confirmed = personFromForm(form);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.person.profile).toMatchObject({
        roleFamily: "backend",
        level: "L5",
        yearsExperience: 7,
        region: "IN-south",
        stack: ["go", "kubernetes"],
      });
      expect(confirmed.person.goal).toEqual(SAMPLE_PERSON.goal);
      expect(confirmed.person.constraints).toEqual({ riskTolerance: "medium", addSkills: [] });
      expect(Profile.safeParse(confirmed.person.profile).success).toBe(true);
      expect(Goal.safeParse(confirmed.person.goal).success).toBe(true);
    }
  });

  it("a partial reading leaves what it did not find empty and lists exactly those as still needed", async () => {
    const result = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
    const form = formFromDraft(result.draft);
    expect(form).toMatchObject({ roleFamily: "backend", level: "L5", years: "", region: "", goalLevel: "" });
    expect(missingFields(form)).toEqual(["years", "region", "goalLevel"]);
  });
});

describe("confirming", () => {
  it("lists every problem in words, not just the first", () => {
    const bad = personFromForm({ ...EMPTY_FORM });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.problems).toHaveLength(5);
      expect(bad.problems.join(" ")).toContain(
        "Years of experience: a number from 0 to 40, in whole or half years.",
      );
    }
  });
  it("accepts half years, refuses quarter years, negatives, over forty, text and blanks", () => {
    expect(personFromForm({ ...filled, years: "7.5" }).ok).toBe(true);
    expect(personFromForm({ ...filled, years: "0" }).ok).toBe(true);
    expect(personFromForm({ ...filled, years: "40" }).ok).toBe(true);
    for (const years of ["7.25", "-1", "41", "seven", "", "  ", "1e1x"])
      expect(personFromForm({ ...filled, years }).ok).toBe(false);
  });
  it("refuses a level, region or goal that is not on the lists", () => {
    expect(personFromForm({ ...filled, level: "L9" }).ok).toBe(false);
    expect(personFromForm({ ...filled, region: "Mars" }).ok).toBe(false);
    expect(personFromForm({ ...filled, goalLevel: "CEO" }).ok).toBe(false);
    expect(personFromForm({ ...filled, roleFamily: "wizard" }).ok).toBe(false);
  });
  it("a blank goal label falls back to the level's words; a long one is cut to 60; a good pay band is kept, a bad one dropped", () => {
    const a = personFromForm({ ...filled, goalLabel: "  " });
    expect(a.ok && a.person.goal.label).toBe("Staff Engineer");
    const b = personFromForm({ ...filled, goalLabel: "x".repeat(90) });
    expect(b.ok && b.person.goal.label.length).toBe(60);
    const c = personFromForm({ ...filled, compBand: "B4" });
    expect(c.ok && c.person.profile.compBand).toBe("B4");
    const d = personFromForm({ ...filled, compBand: "B9" });
    expect(d.ok && "compBand" in d.person.profile).toBe(false);
  });
  it("never keeps more than 15 technologies or 20 milestones", () => {
    const stack = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const milestones = Array.from({ length: 30 }, () => ({
      type: "x",
      quarter: "2024Q1",
      note: "n",
      verified: false as const,
    }));
    const out = personFromForm({ ...filled, stack, milestones });
    expect(out.ok && out.person.profile.stack).toHaveLength(15);
    expect(out.ok && out.person.profile.milestones).toHaveLength(20);
  });
});

describe("editing the form", () => {
  it("changing the goal level also changes the label, unless the person has written their own", () => {
    expect(withGoalLevel({ ...filled, goalLabel: "Staff Engineer" }, "L7").goalLabel).toBe(
      "Principal Engineer",
    );
    expect(withGoalLevel({ ...filled, goalLabel: "My dream job" }, "L7").goalLabel).toBe("My dream job");
    expect(withGoalLevel({ ...EMPTY_FORM }, "EM1")).toMatchObject({
      goalLevel: "EM1",
      goalLabel: "Engineering Manager",
    });
  });
  it("technologies: trimmed, no repeats ignoring case, at most 15, clipped to 40, removable", () => {
    let f = withStackAdded(filled, "  Rust  ");
    expect(f.stack).toEqual(["go", "kubernetes", "Rust"]);
    expect(withStackAdded(f, "GO").stack).toHaveLength(3);
    expect(withStackAdded(f, "   ")).toBe(f);
    expect(withStackAdded(filled, "x".repeat(60)).stack.at(-1)).toHaveLength(40);
    for (let i = 0; i < 20; i++) f = withStackAdded(f, `tool${i}`);
    expect(f.stack).toHaveLength(15);
    expect(withStackRemoved(f, "Rust").stack).not.toContain("Rust");
  });
});

describe("answering a question keeps the person's corrections", () => {
  it("sends the form's valid fields as the earlier draft, and the provenance of only the untouched ones", async () => {
    const result = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
    const original = formFromDraft(result.draft);
    const corrected: FormValues = { ...original, level: "L6", region: "EU-west", years: "abc" };
    expect([...editedKeys(original, corrected)].sort()).toEqual(["level", "region", "yearsExperience"]);
    const previous = previousFrom(result, corrected);
    expect(previous.draft).toMatchObject({ roleFamily: "backend", level: "L6", region: "EU-west" });
    expect("yearsExperience" in previous.draft).toBe(false); // "abc" is not a number, so it is not sent
    expect(Object.keys(previous.provenance)).toEqual(["roleFamily"]); // level was edited, so its provenance is gone
  });
  it("an untouched form sends the draft back as it was, provenance intact", async () => {
    const result = await read({ text: STORY_TEXT }, [fullReading]);
    const previous = previousFrom(result, formFromDraft(result.draft));
    expect(previous.draft).toMatchObject(result.draft);
    expect(previous.provenance).toEqual(result.provenance);
    expect(editedKeys(formFromDraft(result.draft), formFromDraft(result.draft)).size).toBe(0);
  });
  it("a follow-up built this way is accepted by the real server and keeps the corrections", async () => {
    const first = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
    const form = { ...formFromDraft(first.draft), region: "EU-west" };
    const body = intakeBody({ text: "7 years", image: undefined }, previousFrom(first, form));
    const second = await read(body, [yearsReading]);
    expect(second.draft.region).toBe("EU-west");
    expect(second.draft.yearsExperience).toBe(7);
  });
});

describe("intakeBody", () => {
  it("sends only what there is: text, picture, and the earlier draft when answering", () => {
    expect(intakeBody({ text: "hi", image: undefined }, undefined)).toEqual({ text: "hi" });
    expect(
      intakeBody({ text: "", image: { name: "a.png", dataUrl: "data:image/png;base64,AA" } }, undefined),
    ).toEqual({ imageDataUrl: "data:image/png;base64,AA" });
    const previous = { draft: { stack: [], milestones: [] }, provenance: {} };
    expect(intakeBody({ text: "x", image: undefined }, previous)).toEqual({ text: "x", previous });
  });
});

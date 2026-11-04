/** The "Your story" tab as static HTML: the crop warning, labels, provenance, questions, and escaping. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView, TABS } from "../src/components/PathApp";
import { IDLE_INTAKE, type IntakeBindings } from "../src/components/useIntake";
import type { IntakeResult } from "../src/lib/intake";
import { editedKeys, formFromDraft } from "../src/ui/intake";
import { exploreFor } from "./helpers/ui";
import { STORY_TEXT, fullReading, partialReading, read } from "./helpers/intake";

const count = (html: string, needle: string) => html.split(needle).length - 1;
let full: IntakeResult;
let partial: IntakeResult;
beforeAll(async () => {
  full = await read({ text: STORY_TEXT }, [fullReading]);
  partial = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
});

function bindingsFor(result: IntakeResult | undefined, over: Partial<IntakeBindings> = {}): IntakeBindings {
  const form = result ? formFromDraft(result.draft) : IDLE_INTAKE.form;
  return {
    ...IDLE_INTAKE,
    ...(result
      ? { phase: "done" as const, result, form, edited: editedKeys(formFromDraft(result.draft), form) }
      : {}),
    ...over,
  };
}
function view(intake: IntakeBindings, isSample = true, tab: "you" | "map" = "you"): string {
  const { person, data } = exploreFor();
  return renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab={tab}
      selected="climb"
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
      intake={intake}
      isSample={isSample}
    />,
  );
}

describe("the tab", () => {
  it("is the first tab, selected, and its panel is tied to it and shown even while the map data is loading", () => {
    const html = view(IDLE_INTAKE);
    expect(TABS[0]?.id).toBe("you");
    expect(html).toMatch(/id="tab-you"[^>]*aria-selected="true"/);
    expect(html).toMatch(/role="tabpanel" id="panel-you" aria-labelledby="tab-you"/);
    const { person } = exploreFor();
    const loading = renderToStaticMarkup(
      <PathView
        person={person}
        data={undefined}
        error="The server is down."
        tab="you"
        selected="climb"
        onTab={() => undefined}
        onSelect={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(loading).toContain("Tell us about your career");
    expect(loading).not.toContain("The server is down.");
  });
});

describe("before reading", () => {
  const html = view(IDLE_INTAKE);
  it("has a labelled text box, a labelled file picker that takes only pictures, and a counter", () => {
    expect(html).toContain('<label class="control__label" for="intake-text"');
    expect(html).toContain('<label class="control__label" for="intake-file"');
    expect(html).toMatch(/type="file" accept="image\/png,image\/jpeg,image\/webp"/);
    expect(html).toContain("0/6000");
  });
  it("shows the crop warning before the file picker and ties it to the picker", () => {
    expect(html).toContain("Before you upload a screenshot.");
    expect(html).toContain("Crop your screenshot to only the career details you want read");
    expect(html.indexOf("Crop your screenshot")).toBeLessThan(html.indexOf('id="intake-file"'));
    expect(html).toContain('aria-describedby="crop-warning"');
    expect(html).toContain('id="crop-warning"');
  });
  it("says nothing is verified, in the lede and next to the confirm button", () => {
    expect(html).toContain("Nothing it reads is verified");
    expect(html).toContain("Nothing here is verified. It is only what you told us.");
  });
  it("shows the whole form empty with every required field marked Needed, and no sources", () => {
    expect(count(html, "Needed")).toBe(5);
    expect(html).not.toContain("field__source");
    for (const label of ["f-role", "f-level", "f-years", "f-region", "f-goal", "f-goal-label", "f-tech"]) {
      expect(html).toContain(`for="${label}"`);
      expect(html).toContain(`id="${label}"`);
    }
    expect(html).toContain("Use this for my routes");
  });
  it("offers every level and region and role, with people's words", () => {
    expect(html).toContain("South India");
    expect(html).toContain("Staff Engineer");
    expect(html).toContain(">Backend</option>");
    expect(count(html, "<option")).toBe(1 + 6 + 1 + 7 + 1 + 5 + 1 + 7);
  });
});

describe("a complete reading", () => {
  const html = () => view(bindingsFor(full));
  it("fills the form and says under each field where it came from, with the person's own quote", () => {
    const h = html();
    expect(count(h, "Needed")).toBe(0);
    expect(h).toContain("From your words: \u201cbackend engineer\u201d");
    expect(h).toContain("From your words: \u201c7 years\u201d");
    expect(h).toContain("From your words: \u201cL6 Staff Engineer\u201d");
    expect(h).toMatch(/<option value="IN-south" selected="">South India<\/option>/);
    expect(h).toMatch(/id="f-years"[^>]*value="7"/);
  });
  it("says what was found in words, so the panel is never empty", () => {
    expect(html()).toContain("Everything the routes need was found. Please check each field below.");
  });
  it("shows what the server warned about, here the removed email", () => {
    expect(html()).toContain("Removed 1 email address(es)");
  });
  it("technologies are removable chips with names", () => {
    const h = html();
    expect(h).toContain('aria-label="Remove go"');
    expect(h).toContain('aria-label="Remove kubernetes"');
  });
  it("a field the person has changed says Entered by you", () => {
    const form = { ...formFromDraft(full.draft), level: "L6" };
    const h = view(bindingsFor(full, { form, edited: editedKeys(formFromDraft(full.draft), form) }));
    expect(h).toContain("Entered by you");
  });
});

describe("a partial reading", () => {
  const html = () => view(bindingsFor(partial));
  it("asks the questions in a labelled group with an answer box, and marks only what is missing", () => {
    const h = html();
    expect(h).toContain('role="group" aria-label="Questions about what is missing"');
    expect(h).toContain("Some details are still missing.");
    expect(h).toContain("How many years of engineering experience do you have?");
    expect(h).toContain('<label class="control__label" for="intake-answer"');
    expect(h).toContain("Send answer");
    expect(count(h, "Needed")).toBe(3);
  });
});

describe("other states", () => {
  it("nothing found says so and still offers the form", () => {
    const nothing: IntakeResult = {
      ...partial,
      status: "nothing_found",
      questions: [],
      draft: { stack: [], milestones: [] },
      provenance: {},
    };
    const h = view(bindingsFor(nothing));
    expect(h).toContain("Nothing about your career could be found in that.");
    expect(h).toContain("Use this for my routes");
  });
  it("discarded proposals are listed with the reason, never hidden", () => {
    const h = view(
      bindingsFor({ ...full, discarded: ["level: the quoted words are not in what you wrote."] }),
    );
    expect(h).toContain("Read but not used");
    expect(h).toContain("level: the quoted words are not in what you wrote.");
  });
  it("while reading: the button is disabled and the stage is a status", () => {
    const h = view({ ...IDLE_INTAKE, phase: "reading", stage: "Removing contact details\u2026" });
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Reading/);
    expect(h).toMatch(/role="status">Removing contact details/);
  });
  it("a failed read is an alert with Try again", () => {
    const h = view({ ...IDLE_INTAKE, phase: "error", error: "The model is busy." });
    expect(h).toMatch(/role="alert"><p>The model is busy\.<\/p>/);
  });
  it("a problem with the input is an alert tied to the box", () => {
    const h = view({
      ...IDLE_INTAKE,
      problem: "Write a few lines about your career, or upload a cropped screenshot.",
    });
    expect(h).toMatch(/aria-invalid="true" aria-describedby="intake-problem"/);
    expect(h).toMatch(/id="intake-problem" class="turn__error" role="alert"/);
  });
  it("a chosen picture is named with a way to remove it", () => {
    const h = view({ ...IDLE_INTAKE, image: { name: "profile.png", dataUrl: "data:image/png;base64,AA" } });
    expect(h).toContain("Ready to read: profile.png");
    expect(h).toContain("Remove picture");
  });
  it("confirm problems are an alert listing each one", () => {
    const h = view({
      ...IDLE_INTAKE,
      confirmProblems: ["Role: choose one.", "Region: choose one the data covers."],
    });
    expect(h).toMatch(/role="alert" aria-label="Fix these first"/);
    expect(h).toContain("Role: choose one.");
  });
});

describe("the sample banner", () => {
  it("shows on other tabs while the sample is shown, with a button to the story tab, and not once someone is confirmed", () => {
    const sample = view(IDLE_INTAKE, true, "map");
    expect(sample).toContain("You are looking at a sample engineer.");
    expect(sample).toContain("Enter your own story");
    expect(sample).toContain("Sample engineer</li>");
    const own = view(IDLE_INTAKE, false, "map");
    expect(own).not.toContain("sample engineer");
    expect(own).not.toContain("Sample engineer");
  });
  it("is not repeated on the story tab itself", () => {
    expect(view(IDLE_INTAKE, true, "you")).not.toContain("You are looking at a sample engineer.");
  });
});

describe("hygiene", () => {
  it("escapes what the person wrote and what the model returned", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const result: IntakeResult = {
      ...full,
      warnings: [evil],
      discarded: [evil],
      draft: { ...full.draft, stack: [evil] },
      provenance: { roleFamily: { source: "text", quote: evil } },
    };
    const h = view(bindingsFor(result, { text: evil, error: evil, phase: "error", problem: evil }));
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("no literal \\u escapes, undefined, NaN or [object Object]; unique ids; no nested buttons", () => {
    for (const b of [IDLE_INTAKE, bindingsFor(full), bindingsFor(partial)]) {
      const h = view(b);
      expect(h).not.toMatch(/\\u[0-9a-f]{4}|undefined|NaN|\[object Object\]/);
      const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(h).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
    }
  });
});

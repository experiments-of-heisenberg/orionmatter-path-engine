/** The Privacy tab as static HTML: ladder, settings, honest labels, findings, and escaping. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView, TABS } from "../src/components/PathApp";
import { IDLE_PRIVACY, type PrivacyBindings } from "../src/components/usePrivacy";
import type { PrivacyAssessment } from "../src/lib/privacy";
import { exploreFor } from "./helpers/ui";
import { STORY, assessed, modelFindings } from "./helpers/privacy";

const count = (html: string, needle: string) => html.split(needle).length - 1;
let ladderOnly: PrivacyAssessment;
let robotics: PrivacyAssessment;
let withText: PrivacyAssessment;
let codeOnly: PrivacyAssessment;
beforeAll(async () => {
  ladderOnly = await assessed();
  robotics = await assessed({ companyType: "robotics" });
  withText = await assessed({ text: STORY }, [modelFindings]);
  codeOnly = await assessed({ text: STORY, useModel: false });
});

function view(b: Partial<PrivacyBindings> = {}): string {
  const { person, data } = exploreFor();
  return renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab="privacy"
      selected="climb"
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
      privacy={{ ...IDLE_PRIVACY, ...b }}
    />,
  );
}

describe("the tab", () => {
  it("is in the tab list, selected, with its panel tied to it", () => {
    const html = view();
    expect(TABS.map((t) => t.id)).toContain("privacy");
    expect(html).toMatch(/id="tab-privacy"[^>]*aria-selected="true"/);
    expect(html).toMatch(/role="tabpanel" id="panel-privacy" aria-labelledby="tab-privacy"/);
  });
  it("while the ladder loads says so as a status and shows no numbers", () => {
    const html = view();
    expect(html).toMatch(/role="status">Counting\u2026/);
    expect(html).not.toContain("\\u2026");
    expect(html).not.toContain('class="ladder"');
  });
  it("on error shows an alert with Try again", () => {
    const html = view({ ladder: { phase: "error", error: "The model is busy." } });
    expect(html).toMatch(/role="alert"><p>The model is busy\.<\/p>/);
    expect(html).toContain("Try again");
  });
});

describe("the ladder", () => {
  it("shows a bar per step with the number of engineers, a status word, a sentence and the k line, and the synthetic basis", () => {
    const html = view({ ladder: { phase: "done", result: ladderOnly } });
    expect(html).toContain('aria-label="How the crowd shrinks as you share more"');
    expect(count(html, 'class="ladder__row"')).toBe(4);
    for (const text of ["197 engineers", "93 engineers", "68 engineers", "11 engineers"])
      expect(html).toContain(text);
    expect(count(html, "Crowd of 10+")).toBe(4);
    expect(html).toContain("Sharing backend, L5 leaves 93 comparable engineers who match.");
    expect(html).toContain("Sharing all of it still leaves a crowd of at least 10.");
    expect(html).toContain("synthetic cohort of 484 generated career histories");
    expect(count(html, 'class="ladder__k"')).toBe(4);
  });
  it("a step below the crowd says so in words, uses the low style, and the summary says what to leave out", () => {
    const html = view({ ladder: { phase: "done", result: robotics } });
    expect(html).toContain("Fewer than 10");
    expect(html).toContain("ladder__bar ladder__bar--low");
    expect(html).toContain("leave out: region");
    expect(html).toContain("4 engineers");
  });
  it("labels both settings and offers every crowd size and company type, with the current ones selected", () => {
    const html = view({
      ladder: { phase: "done", result: robotics },
      settings: { k: 20, companyType: "robotics" },
    });
    expect(html).toContain('<label class="control__label" for="k-select"');
    expect(html).toContain('<label class="control__label" for="company-select"');
    expect(html).toMatch(/<option value="20" selected="">20 engineers<\/option>/);
    expect(html).toMatch(/<option value="robotics" selected="">robotics<\/option>/);
    expect(count(html, "<option")).toBe(4 + 1 + 5);
  });
  it("shows the server's notes, such as a level the data cannot count", () => {
    const html = view({
      ladder: { phase: "done", result: { ...ladderOnly, notes: ["Your level cannot be counted exactly."] } },
    });
    expect(html).toContain("Your level cannot be counted exactly.");
  });
});

describe("the text check", () => {
  it("before a check: a labelled box, a counter, both buttons, and a plain statement of what is sent where", () => {
    const html = view();
    expect(html).toContain('<label class="control__label" for="story-input"');
    expect(html).toContain("0/3000");
    expect(html).toContain("Check with code only");
    expect(html).toContain("Check with Muse Spark");
    expect(html).toContain("emails, phone numbers and links removed");
    expect(html).toContain("goes to this app");
    expect(html).not.toContain("privacy__result");
  });
  it("a problem with the draft is an alert tied to the box", () => {
    const html = view({ draftProblem: "Paste or type the text you are thinking of sharing." });
    expect(html).toMatch(/aria-invalid="true" aria-describedby="story-problem"/);
    expect(html).toMatch(/id="story-problem" class="turn__error" role="alert"/);
  });
  it("while checking, both buttons are disabled", () => {
    const html = view({ textCheck: { phase: "running", usedModel: true } });
    expect(count(html, 'disabled=""')).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Checking\u2026");
  });
  it("a model check: the risk word with its mark, the reasons, findings with quotes grouped and who found each, and the generalised text", () => {
    const html = view({
      textCheck: {
        phase: "done",
        result: withText,
        usedModel: true,
        settings: { k: 10, companyType: undefined },
      },
    });
    expect(html).toContain("High risk");
    expect(html).toContain("Your text contains contact details that point straight at you.");
    for (const title of ["Contact details", "Employers", "Projects and products"])
      expect(html).toContain(title);
    expect(html).toContain("<q>Acme Robotics</q>");
    expect(html).toContain("Found by code");
    expect(html).toContain("Proposed by Muse Spark, quote checked by code");
    expect(html).toContain("I worked at [a company] on the [a project].");
    expect(html).toContain("Discarded 1 proposed item");
    expect(html).not.toContain("Nobel prize");
    expect(html).not.toContain("is stale");
  });
  it("a code-only check says the model was not used, and shows only what code found", () => {
    const html = view({
      textCheck: {
        phase: "done",
        result: codeOnly,
        usedModel: false,
        settings: { k: 10, companyType: undefined },
      },
    });
    expect(html).toContain("The model was not used");
    expect(html).not.toContain("Proposed by Muse Spark");
  });
  it("a result for other settings says it should be run again", () => {
    const html = view({
      settings: { k: 5, companyType: undefined },
      textCheck: {
        phase: "done",
        result: withText,
        usedModel: true,
        settings: { k: 10, companyType: undefined },
      },
    });
    expect(html).toContain("Run it again to match.");
  });
  it("a failed check is an alert", () => {
    expect(view({ textCheck: { phase: "error", error: "The model is busy." } })).toMatch(
      /role="alert">The model is busy\./,
    );
  });
  it("a low-risk result uses the success mark and word", () => {
    const html = view({
      textCheck: {
        phase: "done",
        result: { ...withText, risk: "low", findings: [], generalisedText: "ok", reasons: ["Fine."] },
        usedModel: true,
        settings: { k: 10, companyType: undefined },
      },
    });
    expect(html).toContain("Low risk");
    expect(html).toContain("privacy__risk--low");
    expect(html).not.toContain("replaced");
  });
});

describe("hygiene", () => {
  it("escapes the person's text and the findings", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = view({
      draft: evil,
      ladder: { phase: "done", result: ladderOnly },
      textCheck: {
        phase: "done",
        result: {
          ...withText,
          findings: [{ quote: evil, category: "other", reason: evil, source: "model" }],
          generalisedText: evil,
        },
        usedModel: true,
        settings: { k: 10, companyType: undefined },
      },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("no literal \\u escapes, stray undefined, NaN or [object Object]; unique ids; no nested buttons", () => {
    for (const b of [
      {},
      { ladder: { phase: "done", result: ladderOnly } as const },
      {
        ladder: { phase: "done", result: robotics } as const,
        textCheck: {
          phase: "done",
          result: withText,
          usedModel: true,
          settings: { k: 10, companyType: undefined },
        } as const,
      },
    ]) {
      const html = view(b);
      expect(html).not.toMatch(/\\u[0-9a-f]{4}|undefined|NaN|\[object Object\]/);
      const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
    }
  });
});

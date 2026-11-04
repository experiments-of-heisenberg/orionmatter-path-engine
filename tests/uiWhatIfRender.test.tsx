/**
 * The What if tab as static HTML: what a person or a screen reader finds. Real explore data, real answers
 * from the real handler, no browser. Behaviour (typing, dragging, streaming) is in whatIfApp.test.tsx.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView, TABS } from "../src/components/PathApp";
import { IDLE_BINDINGS, type WhatIfBindings } from "../src/components/WhatIfPanel";
import type { WhatIfResult } from "../src/lib/api/handlers";
import { finishTurn, startTurn, type Turn } from "../src/ui/chat";
import { withLimit } from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { addScenario, type Scenario } from "../src/ui/scenarios";
import { exploreFor } from "./helpers/ui";
import { sampleConversation } from "./helpers/whatif";

const count = (html: string, needle: string) => html.split(needle).length - 1;
let first: WhatIfResult;
let second: WhatIfResult;
beforeAll(async () => {
  ({ first, second } = await sampleConversation());
});

function view(constraints: object = {}, b: Partial<WhatIfBindings> = {}): string {
  const { person, data } = exploreFor(constraints);
  return renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab="whatif"
      selected="climb"
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
      whatIf={{ ...IDLE_BINDINGS, ...b }}
    />,
  );
}
function conversation(): Turn[] {
  let turns: Turn[] = [];
  const a = startTurn(turns, "What if I won't relocate and want to get there within 2 years?");
  turns = finishTurn(a.turns, a.id, first);
  const b = startTurn(turns, "I want more money, and a 4-day week");
  return finishTurn(b.turns, b.id, second);
}

describe("the tab", () => {
  it("is the second tab, selected, with its panel tied to it", () => {
    const html = view();
    expect(count(html, 'role="tab"')).toBe(TABS.length);
    expect(html).toMatch(/id="tab-whatif"[^>]*aria-selected="true"/);
    expect(html).toMatch(/role="tabpanel" id="panel-whatif" aria-labelledby="tab-whatif"/);
    expect(html.indexOf('id="tab-map"')).toBeLessThan(html.indexOf('id="tab-whatif"'));
    expect(html.indexOf('id="tab-whatif"')).toBeLessThan(html.indexOf('id="tab-compare"'));
  });

  it("shows the map, the cards and every panel, with unique ids", () => {
    const html = view();
    for (const heading of [
      "Your limits",
      "Ask what if",
      "Which limit matters most",
      "What would it take",
      "Scenarios",
      "What changed",
    ]) {
      expect(html).toContain(heading);
    }
    expect(count(html, '<article class="route-card')).toBe(3);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks itself busy while new numbers are on the way, and not otherwise", () => {
    expect(view({}, { refreshing: true })).toContain('aria-busy="true"');
    expect(view()).not.toContain("aria-busy");
  });
});

describe("the limits panel", () => {
  it("labels every control and shows the state in words", () => {
    const html = view({ maxMonths: 24, noRelocation: true, minCompBand: "B4" }, { changed: true });
    expect(html).toContain('<label for="limit-slider"');
    expect(html).toMatch(/<input id="limit-slider"[^>]*type="range"[^>]*min="6"[^>]*max="73"[^>]*value="24"/);
    expect(html).toContain('aria-valuetext="24 months"');
    expect(html).toMatch(/<output[^>]*>24 months<\/output>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>B4<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>B5<\/button>/);
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>(?:(?!<\/button>)[\s\S])*No relocation/);
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>(?:(?!<\/button>)[\s\S])*Remote only/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Medium<\/button>/);
    expect(html).toContain('<label class="control__label" for="skill-input"');
  });

  it("with no limit set, the slider sits at its last stop and says 'No limit'", () => {
    const html = view();
    expect(html).toContain('aria-valuetext="No limit"');
    expect(html).toMatch(/value="73"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Any<\/button>/);
  });

  it("Reset is disabled until something changed", () => {
    expect(view()).toMatch(/<button[^>]*disabled=""[^>]*>Reset<\/button>/);
    expect(view({ maxMonths: 24 }, { changed: true })).not.toMatch(/disabled=""[^>]*>Reset/);
  });

  it("lists skills as removable chips with names, and stops offering the box when full", () => {
    const html = view({ addSkills: ["rust", "go"] });
    expect(html).toContain('aria-label="Stop asking about rust"');
    expect(html).toContain('aria-label="Stop asking about go"');
    const full = view({ addSkills: ["a", "b", "c", "d", "e"] });
    expect(full).toMatch(
      /disabled=""[^>]*placeholder="Up to 5 skills"|placeholder="Up to 5 skills"[^>]*disabled=""/,
    );
  });
});

describe("what changed", () => {
  it("says nothing moved when there is no baseline or nothing differs", () => {
    expect(view()).toContain("Nothing has moved enough to report yet");
    const same = exploreFor().data;
    expect(view({}, { baseline: same })).toContain("Nothing has moved enough to report yet");
  });

  it("with a baseline, lists a chip per change, each with a word a screen reader hears", () => {
    const html = view({ maxMonths: 24 }, { baseline: exploreFor().data });
    expect(html).toContain("Start-here route is now Jump (it was Climb).");
    expect(html).toContain("no one finished within your limits now");
    expect(html).toContain('<span class="sr-only">Worse: </span>');
    expect(html).toContain('<span class="sr-only">Note: </span>');
    expect(html).toContain("since your starting limits");
  });
});

describe("the chat", () => {
  it("empty: offers four examples and a labelled box, and no conversation", () => {
    const html = view();
    expect(html).toContain('aria-label="Examples to try"');
    expect(count(html, 'class="choice"')).toBeGreaterThanOrEqual(4);
    expect(html).toContain('<label for="chat-input" class="sr-only">What would you like to change?</label>');
    expect(html).toContain('aria-label="Conversation"');
  });

  it("with turns: no examples, the person's words, what was applied with the quoted phrase, and what could not be modelled", () => {
    const html = view({}, { turns: conversation() });
    expect(html).not.toContain('aria-label="Examples to try"');
    expect(html).toContain("What if I won&#x27;t relocate and want to get there within 2 years?");
    expect(html).toContain('aria-label="Changes applied"');
    expect(html).toMatch(
      /No relocation<\/span><span class="applied__change">off <span aria-label="changed to">\u2192<\/span> on/,
    );
    expect(html).toContain('<q class="applied__phrase">within 2 years</q>');
    expect(html).toContain("Cannot be modelled");
    expect(html).toContain("Work-week length is not in the cohort data.");
  });

  it("an open question: shown as a group with its options, and the box is labelled with the question", () => {
    const html = view({}, { turns: conversation() });
    expect(html).toContain('role="group" aria-label="A question about your request"');
    for (const option of ["B3", "B4", "B5"])
      expect(html).toMatch(new RegExp(`class="choice"[^>]*>${option}</button>`));
    expect(html).toContain(
      '<label for="chat-input" class="sr-only">Which minimum pay band do you want? B1 is lowest, B5 highest.</label>',
    );
    expect(html).toContain('placeholder="Type your answer');
  });

  it("the explanation says where it came from, and the facts behind it are listed", () => {
    const html = view({}, { turns: conversation() });
    expect(html).toContain("Written directly from the computed facts.");
    expect(html).toContain("The facts behind this");
    expect(html).toMatch(/Start|first route/i);
  });

  it("a held answer says it was understood but not applied, and offers to apply it", () => {
    const turns = conversation()
      .slice(0, 1)
      .map((t) => ({ ...t, held: true }));
    const html = view({}, { turns });
    expect(html).toContain("Understood, not applied");
    expect(html).toContain('aria-label="Changes understood"');
    expect(html).not.toContain('aria-label="Changes applied"');
    expect(html).toContain('aria-label="Held back because you changed your limits"');
    expect(html).toContain("Apply these changes instead");
    expect(html).toContain("Your newer choice stays.");
  });

  it("the half-typed message comes from the parent", () => {
    expect(view({}, { chatDraft: "what if I" })).toContain(">what if I</textarea>");
  });

  it("a working turn shows its stage as a status; a failed one as an alert", () => {
    const working = view({}, { turns: startTurn([], "hello").turns, chatBusy: true });
    expect(working).toMatch(/role="status">Understanding what you asked/);
    expect(working).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Working/);
    const failed = view(
      {},
      { turns: [{ id: 1, message: "hi", status: "error", error: "The model is busy." }] },
    );
    expect(failed).toMatch(/role="alert">The model is busy\./);
  });

  it("escapes the person's own words", () => {
    const turns: Turn[] = [
      { id: 1, message: '<img src=x onerror=alert(1)> & "quotes"', status: "error", error: "<b>bad</b>" },
    ];
    const html = view({}, { turns });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>bad</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;");
  });
});

describe("which limit matters most", () => {
  it("draws one row per limit with worst and best values, ranges and counts, and a text list of every value", () => {
    const html = view();
    expect(count(html, 'class="tornado__row"')).toBe(4);
    expect(html).toContain("swing 83 points");
    expect(html).toMatch(/<strong>Worst:<\/strong> 12 months, none within your limits/);
    expect(html).toMatch(/<strong>Best:<\/strong> 48 months, 74\u201392%, 47 of 55 engineers/);
    expect(count(html, "Every value tried")).toBe(4);
    expect(html).toContain("yours now");
    expect(html).toContain("Time limit matters most");
  });
  it("explains why risk and skills are not bars", () => {
    expect(view()).toContain("Risk tolerance and skills are not shown");
  });
});

describe("what would it take", () => {
  it("says nothing needs to give when the target is already met", () => {
    expect(view()).toContain("Nothing needs to give");
  });
  it("offers the smallest single change with a button when limits leave little room", () => {
    const html = view({ maxMonths: 12 });
    expect(html).toContain("Raise your time limit from 12 months to 23 months");
    expect(html).toMatch(/<button type="button" class="button">Try this<\/button>/);
    expect(html).toContain("One change at a time; no combinations.");
  });
  it("says so when no single change is enough", () => {
    const html = view({ maxMonths: 6, minCompBand: "B5", remote: true });
    expect(html).toMatch(/Try this|No single change/);
  });
});

describe("scenarios", () => {
  const sheet = exploreFor().data;
  const list = (): Scenario[] => {
    const a = addScenario([], SAMPLE_PERSON.constraints, sheet);
    if (!a.ok) throw new Error("a");
    const b = addScenario(
      a.list,
      withLimit(SAMPLE_PERSON.constraints, 24),
      exploreFor({ maxMonths: 24 }).data,
    );
    if (!b.ok) throw new Error("b");
    return b.list;
  };
  it("empty: says nothing is saved", () => {
    expect(view()).toContain("Nothing saved yet.");
  });
  it("a table with scoped headers, one named row per scenario, limits and results in words, and honest leader text", () => {
    const html = view({}, { scenarios: list(), scenarioNotice: "Saved as Scenario B." });
    expect(html).toContain('<caption class="sr-only">Saved scenarios side by side</caption>');
    expect(count(html, 'scope="col"') >= 4).toBe(true);
    expect(html).toContain('aria-label="Name of Scenario A"');
    expect(html).toContain("No limits set");
    expect(html).toContain("Within 24 months");
    expect(html).toContain("Climb \u00b7 74\u201392% \u00b7 34\u201340 months \u00b7 55 engineers");
    expect(html).toContain("Highest, clearly");
    expect(html).toMatch(/role="status">Saved as Scenario B\./);
    expect(html).toContain('aria-label="Remove Scenario A"');
  });
  it("Save is disabled at four scenarios", () => {
    const four = [
      ...list(),
      { ...list()[0], id: "sc-C", name: "C" },
      { ...list()[0], id: "sc-D", name: "D" },
    ] as Scenario[];
    expect(view({}, { scenarios: four })).toMatch(/<button[^>]*disabled=""[^>]*>Save these limits<\/button>/);
  });
  it("escapes a scenario name", () => {
    const l = list();
    const html = view({}, { scenarios: [{ ...(l[0] as Scenario), name: "<script>alert(1)</script>" }] });
    expect(html).not.toContain("<script>alert(1)");
  });
});

describe("hygiene", () => {
  it("no stray undefined, NaN or [object Object] in any state", () => {
    const states: [object, Partial<WhatIfBindings>][] = [
      [{}, {}],
      [{ maxMonths: 24 }, { baseline: exploreFor().data, changed: true }],
      [{ maxMonths: 12 }, { turns: conversation() }],
      [{ minCompBand: "B5", remote: true, noRelocation: true, maxMonths: 6 }, {}],
    ];
    for (const [c, b] of states) expect(view(c, b)).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
  it("never nests a button in a button", () => {
    const html = view({ maxMonths: 12 }, { turns: conversation() });
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });
});

/**
 * The stylesheet's What if half: every class the What if tab renders is styled, the accent text colour
 * is a variable in both themes, the small-screen rules collapse the grid, and touch targets are tall enough.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView } from "../src/components/PathApp";
import { IDLE_BINDINGS, type WhatIfBindings } from "../src/components/WhatIfPanel";
import type { WhatIfResult } from "../src/lib/api/handlers";
import { finishTurn, startTurn, type Turn } from "../src/ui/chat";
import { withLimit } from "../src/ui/limits";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { addScenario, type Scenario } from "../src/ui/scenarios";
import { exploreFor } from "./helpers/ui";
import { sampleConversation } from "./helpers/whatif";

const css = readFileSync("src/app/globals.css", "utf8");
const noop = () => undefined;

let first: WhatIfResult;
let second: WhatIfResult;
beforeAll(async () => {
  ({ first, second } = await sampleConversation());
});

function conversation(): Turn[] {
  const a = startTurn([], "What if I won't relocate and want to get there within 2 years?");
  const one = finishTurn(a.turns, a.id, first);
  const b = startTurn(one, "I want more money, and a 4-day week");
  return finishTurn(b.turns, b.id, second);
}

function scenarios(): Scenario[] {
  const sheet = exploreFor().data;
  const a = addScenario([], SAMPLE_PERSON.constraints, sheet);
  if (!a.ok) throw new Error("first scenario");
  const b = addScenario(a.list, withLimit(SAMPLE_PERSON.constraints, 24), exploreFor({ maxMonths: 24 }).data);
  if (!b.ok) throw new Error("second scenario");
  return b.list;
}

/** Every class token in the static markup of the What if tab across a spread of states. */
function collectWhatIfClasses(): Set<string> {
  const used = new Set<string>();
  const keep = (html: string) => {
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const token of (m[1] ?? "").split(/\s+/)) {
        if (token) used.add(token);
      }
    }
  };
  const states: [object, Partial<WhatIfBindings>][] = [
    [{}, {}],
    [
      { maxMonths: 24, minCompBand: "B4", remote: true, noRelocation: true, addSkills: ["rust", "go"] },
      {
        baseline: exploreFor().data,
        changed: true,
        turns: conversation(),
        scenarios: scenarios(),
        scenarioNotice: "Saved as Scenario B.",
      },
    ],
    [{ maxMonths: 12 }, { turns: conversation(), refreshing: true, chatBusy: true }],
    [{}, { turns: [{ id: 1, message: "hi", status: "error", error: "The model is busy." }] }],
    [{}, { turns: startTurn([], "hello").turns, chatBusy: true }],
  ];
  for (const [constraints, bindings] of states) {
    const { person, data } = exploreFor(constraints);
    keep(
      renderToStaticMarkup(
        createElement(PathView, {
          person: person,
          data,
          error: undefined,
          tab: "whatif",
          selected: "climb",
          onTab: noop,
          onSelect: noop,
          onRetry: noop,
          whatIf: { ...IDLE_BINDINGS, ...bindings },
        }),
      ),
    );
  }
  return used;
}

/**
 * Classes the What if tab renders that deliberately have no rule of their own. Each needs a reason;
 * anything else that is rendered but never styled fails the test below. (Classes shared with the
 * other tabs are covered by tests/uiCss.test.ts; only the What if render is collected here.)
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  app: "root wrapper; layout comes from its children",
  constellation__svg: "sized by the .constellation__body svg element selector",
  "lane--selected": "state hook only; the visual change comes from SVG props",
  "map-limit": "grouping <g>; its line, label and hatch carry the styling",
  "route-card__empty": "wrapper; its text uses the shared big/small styles",
  controls: "semantic hook on the limits panel; the card styling comes from .panel",
  chat: "semantic hook on the chat panel; the card styling comes from .panel",
  tornado__row: "grid item; spacing comes from the .tornado gap",
  turn: "grid item; spacing comes from the .turns gap",
  // Reported: a named grid cell with no rule of its own. Harmless today (placement comes from
  // .applied__item), but if it ever needs its own alignment it must gain a rule.
  applied__change: "grid cell; placement comes from the .applied__item columns",
};

const isDefined = (cls: string): boolean => new RegExp("\\." + cls + "(?![\\w-])").test(css);

describe("what-if stylesheet coverage", () => {
  it("every class the What if tab renders is styled, or is on the explicit allowlist", () => {
    const unstyled = [...collectWhatIfClasses()].filter((cls) => !(cls in ALLOWLIST) && !isDefined(cls));
    expect(unstyled).toEqual([]);
  });

  it("every allowlisted class is still rendered, so the list cannot rot", () => {
    const used = collectWhatIfClasses();
    for (const cls of Object.keys(ALLOWLIST)) {
      expect(used.has(cls), `${cls} is allowlisted but never rendered`).toBe(true);
    }
  });
});

describe("accent text colour", () => {
  it("--on-accent is defined in :root and in the dark block", () => {
    const roots = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((m) => m[1] ?? "");
    expect(roots.length).toBeGreaterThanOrEqual(2);
    for (const block of roots) expect(block).toContain("--on-accent:");
  });

  it(".button--primary uses it, and no hard-coded white text sits on the accent anywhere", () => {
    const primary = /\.button--primary\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(primary).toContain("var(--accent)");
    expect(primary).toContain("var(--on-accent)");
    // The only hard-coded whites left are a variable definition, a map focus outline, and the
    // switch thumb's fill (a background, not text) — none of them white text on the accent.
    expect(css).not.toMatch(/color:\s*(#fff|#ffffff|white)\b/i);
  });
});

describe("small screens", () => {
  const narrow = (css.split("@media (max-width: 860px)")[1] ?? "").split("@media")[0] ?? "";

  it("at 860px the What if grid, the take cards and the tornado ends collapse", () => {
    expect(narrow).toMatch(/\.whatif__grid[\s\S]*?grid-template-columns:\s*1fr/);
    expect(narrow).toMatch(/\.take__card[\s\S]*?flex-direction:\s*column/);
    expect(narrow).toMatch(/\.tornado__ends[\s\S]*?flex-direction:\s*column/);
  });

  it("the scenarios table keeps a min-width so its wrapper scrolls instead of squeezing", () => {
    const table = /\.scenarios__table\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(table).toMatch(/min-width:\s*\d+px/);
    const wrap = /\.compare__table-wrap\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(wrap).toContain("overflow-x: auto");
  });
});

describe("touch targets", () => {
  /** The height or min-height in px declared for a selector, or null when it declares neither. */
  function heightOf(selector: string): number | null {
    const block = new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1] ?? "";
    const match = /(?:min-height|height):\s*(\d+)px/.exec(block);
    return match?.[1] ? Number(match[1]) : null;
  }

  it("the slider, choice buttons and switch are all at least 32px tall", () => {
    expect(heightOf(".slider")).toBe(32);
    expect(heightOf(".choice")).toBe(36);
    expect(heightOf(".switch")).toBe(48);
    for (const selector of [".slider", ".choice", ".switch"]) {
      expect(heightOf(selector) ?? 0).toBeGreaterThanOrEqual(32);
    }
  });
});

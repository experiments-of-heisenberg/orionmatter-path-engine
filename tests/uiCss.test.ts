/**
 * The stylesheet covers every class the components render, defines the variables it uses,
 * and keeps its responsive and motion rules. Classes are collected by rendering every view.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathView, type Tab } from "../src/components/PathApp";
import type { Archetype } from "../src/ui/format";
import { SAMPLE_PERSON, type Person } from "../src/ui/sample";
import { embeddedPerson, exploreFor } from "./helpers/ui";

const css = readFileSync("src/app/globals.css", "utf8");
const noop = () => undefined;

const em2: Person = { ...SAMPLE_PERSON, goal: { targetLevel: "EM2", label: "Director" } };

/** Every class token in the static markup of every view, tab and shell. */
function collectUsedClasses(): Set<string> {
  const used = new Set<string>();
  const keep = (html: string) => {
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const token of (m[1] ?? "").split(/\s+/)) {
        if (token) used.add(token);
      }
    }
  };
  const persons: Person[] = [SAMPLE_PERSON, embeddedPerson(), em2];
  const constraintSets: object[] = [
    {},
    { maxMonths: 24 },
    { maxMonths: 12 },
    { minCompBand: "B5" },
    { addSkills: ["rust", "go"] },
  ];
  for (const person of persons) {
    for (const constraints of constraintSets) {
      const { person: p, data } = exploreFor(constraints, person);
      for (const tab of ["map", "compare", "why"] as Tab[]) {
        for (const selected of ["climb", "jump", "pivot"] as Archetype[]) {
          keep(
            renderToStaticMarkup(
              createElement(PathView, {
                person: p,
                data,
                error: undefined,
                tab,
                selected,
                onTab: noop,
                onSelect: noop,
                onRetry: noop,
              }),
            ),
          );
        }
      }
    }
  }
  keep(
    renderToStaticMarkup(
      createElement(PathView, {
        person: SAMPLE_PERSON,
        data: undefined,
        error: undefined,
        tab: "map",
        selected: "climb",
        onTab: noop,
        onSelect: noop,
        onRetry: noop,
      }),
    ),
  );
  keep(
    renderToStaticMarkup(
      createElement(PathView, {
        person: SAMPLE_PERSON,
        data: undefined,
        error: "The model is busy.",
        tab: "map",
        selected: "climb",
        onTab: noop,
        onSelect: noop,
        onRetry: noop,
      }),
    ),
  );
  return used;
}

const used = collectUsedClasses();

/**
 * Classes that are used but deliberately have no rule of their own. Each needs a reason;
 * anything else that is used but never styled fails the test below and must either gain
 * a style or earn its place here.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  app: "root wrapper; layout comes from its children",
  compare__radar: "wrapper; the svg and toggles inside carry the styling",
  constellation__svg: "sized by the .constellation__body svg element selector",
  "lane--selected": "state hook only; the visual change comes from SVG props",
  "map-limit": "grouping <g>; its line, label and hatch carry the styling",
  outcome: "wrapper; the bar and legend inside carry the styling",
  outcome__seg: "width and colour come from inline style and the --late/--stalled/--left modifiers",
  "route-card__empty": "wrapper; its text uses the shared big/small styles",
  skeleton: "wrapper; the map and card placeholders inside carry the styling",
};

const isDefined = (cls: string): boolean => new RegExp("\\." + cls + "(?![\\w-])").test(css);

describe("stylesheet coverage", () => {
  it("every rendered class is styled, or is on the explicit allowlist", () => {
    const unstyled = [...used].filter((cls) => !(cls in ALLOWLIST) && !isDefined(cls));
    expect(unstyled).toEqual([]);
  });

  it("every allowlisted class is still rendered, so the list cannot rot", () => {
    for (const cls of Object.keys(ALLOWLIST)) {
      expect(used.has(cls), `${cls} is allowlisted but never rendered`).toBe(true);
    }
  });
});

describe("themes and variables", () => {
  it("defines a dark theme that follows the system", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    const dark = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\}\s*\}(?!\s*\{)/.exec(css)?.[1] ?? "";
    expect(dark).toContain("--bg:");
  });

  it("defines a reduced-motion block", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("defines every custom property it uses, at :root or in the dark block", () => {
    const defined = new Set<string>();
    for (const m of css.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
      for (const d of (m[1] ?? "").matchAll(/(--[\w-]+)\s*:/g)) {
        if (d[1]) defined.add(d[1]);
      }
    }
    expect(defined.has("--bg")).toBe(true); // sanity: the :root parse found the tokens
    const varAllowlist: Readonly<Record<string, string>> = {
      "--font-geist-sans": "defined by the Geist Next.js font integration at runtime",
      "--route": "set inline per component via the style prop",
    };
    for (const m of css.matchAll(/var\((--[\w-]+)\)/g)) {
      const name = m[1] ?? "";
      expect(defined.has(name) || name in varAllowlist, `${name} is used but never defined`).toBe(true);
    }
  });
});

describe("important and breakpoints", () => {
  it("uses !important only inside the prefers-reduced-motion block", () => {
    const parts = css.split("@media (prefers-reduced-motion: reduce)");
    expect(parts).toHaveLength(2);
    expect(parts[0] ?? "").not.toContain("!important");
    expect(parts[1] ?? "").toContain("!important");
  });

  it("keeps the 860px and 720px breakpoints", () => {
    expect(css).toContain("(max-width: 860px)");
    expect(css).toContain("(max-width: 720px)");
  });

  it("hides the compact map by default and shows it at 720px while hiding the desktop one", () => {
    expect(css).toMatch(/\.constellation__body--compact\s*\{\s*display:\s*none;?\s*\}/);
    const narrow = (css.split("@media (max-width: 720px)")[1] ?? "").split("@media")[0] ?? "";
    expect(narrow).toMatch(/\.constellation__body--desktop\s*\{\s*display:\s*none;?\s*\}/);
    expect(narrow).toMatch(/\.constellation__body--compact\s*\{\s*display:\s*block;?\s*\}/);
  });
});

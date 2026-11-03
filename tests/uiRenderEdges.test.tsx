/**
 * Edge cases for the rendered screen: selection, limits, escaping, toggles, skills and best cells.
 * Like the main render tests, these render PathView to static HTML with real explore data.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathView, type Tab } from "../src/components/PathApp";
import { ComparePanel } from "../src/components/Panels";
import { RadarChart } from "../src/components/RadarChart";
import type { Archetype } from "../src/ui/format";
import { SAMPLE_PERSON, type Person } from "../src/ui/sample";
import { exploreFor } from "./helpers/ui";

const noop = () => undefined;
function render(
  constraints: object = {},
  tab: Tab = "map",
  selected: Archetype = "climb",
  person: Person = exploreFor().person,
) {
  const { person: p, data } = exploreFor(constraints, person);
  return renderToStaticMarkup(
    <PathView
      person={p}
      data={data}
      error={undefined}
      tab={tab}
      selected={selected}
      onTab={noop}
      onSelect={noop}
      onRetry={noop}
    />,
  );
}
const count = (html: string, needle: string) => html.split(needle).length - 1;
const LABEL: Record<Archetype, string> = { climb: "Climb", jump: "Jump", pivot: "Pivot" };

describe("selecting a route", () => {
  for (const selected of ["climb", "jump", "pivot"] as const) {
    it(`selecting ${selected} changes the caption, the detail heading and the pressed states`, () => {
      const html = render({}, "map", selected);
      expect(html).toContain(`<strong>${LABEL[selected]}:</strong>`);
      expect(html).toContain(`${LABEL[selected]} in detail`);
      expect(count(html, 'class="route-card__button" aria-pressed="true"')).toBe(1);
      expect(count(html, "lane--selected")).toBe(2); // one drawn route per layout
    });
  }

  it("every unselected drawn route is dimmed, in the desktop and the phone version", () => {
    const html = render({}, "map", "jump");
    expect(count(html, "lane--dim")).toBe(4);
    const [desktop, compact] = html.split("constellation__body--compact");
    expect(desktop ?? "").toContain("lane--selected");
    expect(compact ?? "").toContain("lane--selected");
    expect(count(desktop ?? "", "lane--dim")).toBe(2);
    expect(count(compact ?? "", "lane--dim")).toBe(2);
  });
});

describe("limits and ids", () => {
  it("the limit label appears only when maxMonths is set", () => {
    expect(render({})).not.toContain("Your limit");
    expect(render({ maxMonths: 24 })).toContain("Your limit · 24 mo");
  });

  it("the hatch pattern ids are unique across the desktop and phone SVGs", () => {
    const html = render({ maxMonths: 24 });
    const ids = [...html.matchAll(/id="(late-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length); // no collision in one document
    const refs = [...html.matchAll(/url\(#(late-[^")]+)\)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ids).toContain(ref);
  });
});

describe("a pay floor with no time limit", () => {
  it("shows no 'Your limit' text and keeps three correct cards", () => {
    const html = render({ minCompBand: "B5" });
    expect(html).not.toContain("Your limit");
    expect(count(html, '<article class="route-card')).toBe(3);
    for (const name of ["Climb", "Jump", "Pivot"]) expect(html).toContain(`>${name}</button>`);
    expect(html).toContain("Pay band reached");
  });
});

describe("tab panels", () => {
  for (const tab of ["map", "compare", "why"] as const) {
    it(`the ${tab} panel's id and aria-labelledby match the selected tab`, () => {
      expect(render({}, tab)).toContain(`id="panel-${tab}" aria-labelledby="tab-${tab}"`);
    });
  }
});

describe("escaping user-controlled strings", () => {
  const evil: Person = {
    ...SAMPLE_PERSON,
    profile: { ...SAMPLE_PERSON.profile, stack: ["<script>alert(1)</script>", 'go" onmouseover="x'] },
    goal: { targetLevel: "L6", label: `Staff <img src=x onerror=alert(1)> "R&D"` },
  };

  it("escapes the goal label everywhere and never prints the raw markup", () => {
    const html = render({}, "map", "climb", evil);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("R&D");
    expect(html).toContain("R&amp;D");
    expect(html).toContain("&quot;"); // the quotes, inside an aria-label attribute
  });

  it("states it: profile stack skills are not rendered anywhere, so their markup cannot leak", () => {
    const html = render({}, "map", "climb", evil);
    expect(html).not.toContain("&lt;script");
    expect(html).not.toContain("onmouseover");
  });
});

describe("the radar toggles", () => {
  it("with two routes hidden, only one data polygon renders", () => {
    // ComparePanel keeps its hidden set in useState, so it cannot be preset from outside;
    // test RadarChart directly with the same hidden set.
    const { data } = exploreFor();
    const html = renderToStaticMarkup(
      <RadarChart routes={data.routes} selected="climb" hidden={new Set(["jump", "pivot"])} />,
    );
    expect(count(html, "<polygon") - count(html, "radar__ring")).toBe(1);
  });
});

describe("skills asked about", () => {
  const { person: p, data } = exploreFor({ addSkills: ["rust", "go"] });
  const html = renderToStaticMarkup(
    <PathView
      person={p}
      data={data}
      error={undefined}
      tab="map"
      selected="climb"
      onTab={noop}
      onSelect={noop}
      onRetry={noop}
    />,
  );
  const skills = /<ul class="skill-list">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";

  it("prints one line per skill", () => {
    expect(count(skills, "<li>")).toBe(2);
  });

  it("says there is no evidence for the unknown skill", () => {
    expect(skills).toContain("the data has no evidence about this skill");
  });

  it("says the ranges overlap for rust and marks its thin group as limited evidence", () => {
    expect(skills).toContain("ranges overlap");
    expect(skills).toContain("Limited evidence");
  });
});

describe("compare best cells", () => {
  it("every axis row marks one or more cells as best", () => {
    const html = render({}, "compare");
    const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map((m) => m[1] ?? "")
      .filter((row) => row.includes("score</th>"));
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(count(row, "cell--best")).toBeGreaterThanOrEqual(1);
  });

  it("ties mark every tied cell", () => {
    const { data } = exploreFor();
    const tied = { ...data, routes: data.routes.map((r) => ({ ...r, radar: { ...r.radar, comp: 50 } })) };
    const html = renderToStaticMarkup(<ComparePanel sheet={tied} selected="climb" />);
    const pay = /<th scope="row">Pay score<\/th>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? "";
    expect(count(pay, "cell--best")).toBe(3);
  });
});

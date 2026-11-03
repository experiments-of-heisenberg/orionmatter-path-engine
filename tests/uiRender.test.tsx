/**
 * Render tests for the screen. The view is a pure function of its props, so it is rendered to static HTML
 * with real explore data and checked for what a person (or a screen reader) would find: names, states,
 * text equivalents of the drawings, and the honest labels.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathView, type Tab } from "../src/components/PathApp";
import type { Archetype } from "../src/ui/format";
import { embeddedPerson, exploreFor } from "./helpers/ui";

const noop = () => undefined;
function render(
  constraints: object = {},
  tab: Tab = "map",
  selected: Archetype = "climb",
  person = exploreFor().person,
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

describe("the page", () => {
  const html = render();

  it("names the goal, says who the person is, and labels the data as synthetic", () => {
    expect(html).toContain("<h1");
    expect(html).toContain("Your route to Staff Engineer");
    for (const chip of ["Backend", "L5", "7 years", "South India", "Synthetic cohort of 484 engineers"])
      expect(html).toContain(chip);
    expect(html).toContain("The cohort is synthetic");
  });

  it("is a labelled tab list with the Map tab selected and a tab panel tied to it", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/id="tab-map"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="tab-compare"[^>]*aria-selected="false"/);
    expect(html).toMatch(/role="tabpanel" id="panel-map" aria-labelledby="tab-map"/);
    expect(count(html, 'tabindex="0"')).toBeGreaterThanOrEqual(1);
    expect(html).toMatch(/id="tab-why"[^>]*tabindex="-1"/);
  });

  it("gives the map a name and each route a button role, a pressed state and a full sentence", () => {
    expect(html).toContain(
      'aria-label="Map of three routes to Staff Engineer. Distance to the right is months from today."',
    );
    for (const name of ["Climb", "Jump", "Pivot"]) expect(html).toContain(`aria-label="${name} route. `);
    expect(html).toContain("Usually 34\u201340 months. 74\u201392% got there. Based on 55 engineers.");
    expect(html).toMatch(/role="button"[^>]*aria-pressed="true"[^>]*aria-label="Climb route/);
    expect(count(html, 'role="button"')).toBe(6); // three routes drawn twice (desktop and phone versions)
  });

  it("has a text legend for the map, and a plain caption under it", () => {
    for (const text of [
      "Distance is months from today",
      "Soft band is the typical window",
      "Bigger star means more engineers made it",
      "Hollow and dashed means limited evidence",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('aria-live="polite"');
  });

  it("shows three route cards with ranges, sample sizes and a single 'Start here'", () => {
    expect(count(html, '<article class="route-card')).toBe(3);
    for (const text of [
      "34\u201340 months",
      "18\u201323 months",
      "42\u201349 months",
      "55 comparable engineers, 47 made it",
      "65 comparable engineers, 44 made it",
    ])
      expect(html).toContain(text);
    expect(count(html, "Start here")).toBe(1);
    expect(html).toMatch(/Climb<\/button>[\s\S]*Start here/);
  });

  it("gives every range bar and meter a text equivalent", () => {
    expect(html).toContain('aria-label="Typical time 34\u201340 months on a scale from 0 to 60 months"');
    expect(html).toContain('aria-label="Success range 74\u201392% on a scale from 0 to 100 percent"');
  });

  it("shows the selected route in detail, with a text summary of the chart and of the outcome bar", () => {
    expect(html).toContain("Climb in detail");
    expect(html).toContain("47 comparable engineers reached the goal, between 30 and 44 months.");
    expect(html).toContain("Reached the goal 86 percent, Stalled 9 percent, Left the field 5 percent");
  });

  it("makes the selected route's colour and the tab order irrelevant to meaning: every route is also named in text", () => {
    for (const name of ["Climb", "Jump", "Pivot"]) expect(count(html, `>${name}<`)).toBeGreaterThanOrEqual(1);
  });
});

describe("honest states", () => {
  it("under a 24-month limit: the limit is labelled, two routes say none within limits, and the detail explains the late ones", () => {
    const html = render({ maxMonths: 24 }, "map", "jump");
    expect(html).toContain("Your limit · 24 mo");
    expect(count(html, "None within your limits")).toBe(2);
    expect(html).toContain("Not within your limits");
    expect(html).toContain(
      "85% of 55 comparable engineers reached it, but not within your limits. The fastest took 30 months.",
    );
    expect(html).toContain("Jump in detail");
    expect(html).toContain("Reached it, but later");
    expect(html).toContain("Reached it within your limits");
    expect(html).toContain("36 of them within your limits");
  });

  it("with thin evidence: the badge, the dashed legend and the limited-evidence sentence appear", () => {
    const html = render({}, "map", "climb", embeddedPerson());
    expect(html).toContain("Limited evidence");
    expect(html).toMatch(/Limited evidence\./);
  });

  it("with no comparable engineers: says so on the map labels and cards, and never invents a range", () => {
    const person = { ...exploreFor().person, goal: { targetLevel: "EM2", label: "Director" } };
    const html = render({}, "map", "climb", person);
    expect(html).toContain("No comparable engineers");
    expect(html).toContain("No data");
    expect(html).not.toMatch(/\d+\u2013\d+ months/);
  });

  it("shows the conflict notice when the limit leaves no route", () => {
    const html = render({ maxMonths: 12 });
    expect(html).toContain('role="status"');
    expect(html).toContain("within 12 months");
    expect(count(html, "None within your limits")).toBe(3);
  });

  it("never shows the 'outside your limits' share as a risk chip", () => {
    const html = render({ maxMonths: 24 }, "map", "jump");
    expect(html).not.toMatch(/chip chip--amber[^>]*>reached the goal, but outside your limits/);
  });
});

describe("compare and why tabs", () => {
  it("compare: a radar with a text description, toggles, and a table with scoped headers and the best scores marked", () => {
    const html = render({}, "compare");
    expect(html).toMatch(/aria-selected="true"[^>]*>Compare/);
    expect(html).toContain("Radar comparing the routes on six measures from 0 to 100.");
    expect(html).toContain("Climb: Pay 88");
    expect(count(html, 'scope="col"')).toBe(4);
    expect(count(html, 'scope="row"')).toBeGreaterThanOrEqual(10);
    expect(html).toContain("cell--best");
    expect(count(html, 'aria-pressed="true"')).toBe(3);
    expect(html).toContain('<caption class="sr-only">The three routes side by side</caption>');
  });

  it("why: explains the order, what a range means, what the numbers cannot tell, and the six measures", () => {
    const html = render({}, "why");
    for (const text of [
      "Why this order",
      "What a range means",
      "What this cannot tell you",
      "The six measures",
      "synthetic cohort of generated career histories",
      "not a promise",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("did not reach the goal");
    for (const axis of ["Pay", "Speed", "Odds", "Learning", "Balance", "Stability"])
      expect(html).toContain(`<dt>${axis}</dt>`);
  });
});

describe("loading and error", () => {
  const { person } = exploreFor();
  const shell = (data: undefined, error: string | undefined) =>
    renderToStaticMarkup(
      <PathView
        person={person}
        data={data}
        error={error}
        tab="map"
        selected="climb"
        onTab={noop}
        onSelect={noop}
        onRetry={noop}
      />,
    );

  it("while loading shows a labelled busy skeleton and no numbers", () => {
    const html = shell(undefined, undefined);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading your routes"');
    expect(html).not.toMatch(/\d+\u2013\d+ months/);
  });

  it("on error shows an alert with the message and a Try again button, and no skeleton", () => {
    const html = shell(undefined, "The model is busy.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("The model is busy.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("aria-busy");
  });
});

describe("markup hygiene", () => {
  it("does not nest interactive elements: no button inside a button, ids are unique per tab", () => {
    const html = render();
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains no stray undefined, NaN or [object Object]", () => {
    for (const c of [{}, { maxMonths: 24 }, { maxMonths: 12 }, { minCompBand: "B5" }]) {
      for (const tab of ["map", "compare", "why"] as Tab[]) {
        expect(render(c, tab)).not.toMatch(/undefined|NaN|\[object Object\]/);
      }
    }
  });
});

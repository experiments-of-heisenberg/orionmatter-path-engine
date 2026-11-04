/** The Share tab and the card as static HTML: the card's words, what is withheld, and escaping. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView } from "../src/components/PathApp";
import { TrailCard } from "../src/components/TrailCard";
import { IDLE_PRIVACY, type PrivacyBindings } from "../src/components/usePrivacy";
import type { PrivacyAssessment } from "../src/lib/privacy";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { trailCardModel } from "../src/ui/trailCard";
import { exploreFor } from "./helpers/ui";
import { assessed } from "./helpers/privacy";

const count = (html: string, needle: string) => html.split(needle).length - 1;
let ladder10: PrivacyAssessment;
let ladder70: PrivacyAssessment;
beforeAll(async () => {
  ladder10 = await assessed();
  ladder70 = await assessed({ k: 70 });
});

function view(b: Partial<PrivacyBindings>, constraints: object = {}): string {
  const { person, data } = exploreFor(constraints);
  return renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab="share"
      selected="climb"
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
      privacy={{ ...IDLE_PRIVACY, ...b }}
    />,
  );
}

describe("the Share tab", () => {
  it("while the privacy count loads offers no card, only a status", () => {
    const html = view({});
    expect(html).toMatch(/role="status">Working out what is safe to show/);
    expect(html).not.toContain("trail-card");
    expect(html).not.toContain("Save as picture");
  });
  it("if the count cannot be loaded, offers no card and says why", () => {
    const html = view({ ladder: { phase: "error", error: "The server is down." } });
    expect(html).toMatch(/role="alert"><p>The card needs the privacy count first/);
    expect(html).toContain("The server is down.");
    expect(html).not.toContain("trail-card");
  });
  it("with the count: the card, what is on it, the crowd it leaves, that nothing is uploaded, and three ways to save", () => {
    const html = view({ ladder: { phase: "done", result: ladder10 } });
    expect(html).toContain("Backend, L5, Goal: Staff Engineer, South India");
    expect(html).toContain("Together they match 11 comparable engineers.");
    expect(html).toContain("nothing is uploaded");
    expect(html).toContain(
      "Years of experience, technologies and anything you wrote are never put on the card.",
    );
    for (const button of ["Save as picture", "Save as SVG", "Copy as text"]) expect(html).toContain(button);
    expect(html).not.toContain("Left off:");
    expect(html).toContain("The card as text");
  });
  it("with a larger crowd required: says what is left off and why, and the card does not carry the withheld details", () => {
    const html = view({
      ladder: { phase: "done", result: ladder70 },
      settings: { k: 70, companyType: undefined },
    });
    expect(html).toContain("Left off:");
    expect(html).toContain("withheld to keep you in a crowd of 70 or more");
    const start = html.indexOf('<svg class="trail-card"');
    const card = html.slice(start, html.indexOf("</svg>", start) + 6);
    expect(card).not.toContain("Staff Engineer");
    expect(card).not.toContain("South India");
    expect(card).toContain("My routes to the next level");
    expect(html).toContain("at least 70");
  });
});

describe("the card", () => {
  const render = (ladder: PrivacyAssessment, constraints: object = {}) => {
    const { person, data } = exploreFor(constraints);
    return renderToStaticMarkup(<TrailCard model={trailCardModel(person, data, ladder)} />);
  };
  it("is one SVG of fixed size with a description of everything on it", () => {
    const html = render(ladder10);
    expect(html).toContain('viewBox="0 0 1200 630"');
    expect(html).toContain('role="img"');
    expect(html).toContain(
      "Trail card. My route to Staff Engineer. Climb: 34\u201340 months. Jump: 18\u201323 months. Pivot: 42\u201349 months.",
    );
    expect(count(html, "<svg")).toBe(1);
  });
  it("names each route, gives its range and count, marks the start-here route in words, and carries the honest footer", () => {
    const html = render(ladder10);
    for (const text of [
      ">Climb<",
      ">Jump<",
      ">Pivot<",
      "74\u201392%",
      "55 engineers",
      "Start here",
      "Synthetic cohort of 484 engineers. Ranges, not promises.",
    ])
      expect(html).toContain(text);
    expect(count(html, ">Start here<")).toBe(1);
  });
  it("a route nobody finished in time says so and has no bar; the limit is on the card", () => {
    const html = render(ladder10, { maxMonths: 24 });
    expect(count(html, ">None within these limits")).toBe(2);
    expect(html).toContain("Within 24 months");
  });
  it("shows a withheld-details line instead of an empty one when nothing may be shown", async () => {
    const html = render(await assessed({ k: 500 }));
    expect(html).toContain("Details withheld to protect you");
  });
  it("escapes the goal label, and has no literal \\u escapes, undefined, NaN", () => {
    const person = { ...SAMPLE_PERSON, goal: { targetLevel: "L6", label: "<img src=x onerror=alert(1)>" } };
    const html = renderToStaticMarkup(
      <TrailCard model={trailCardModel(person, exploreFor().data, ladder10)} />,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(render(ladder10)).not.toMatch(/\\u[0-9a-f]{4}|undefined|NaN|\[object Object\]/);
  });
});

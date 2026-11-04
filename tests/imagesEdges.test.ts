// @vitest-environment jsdom
/**
 * imagesEdges.test.ts: the README pictures are well-formed, labelled SVGs.
 *
 * Why: docs/images/map.svg and trail-card.svg are embedded in the README and
 * represent the product to judges. They must parse as XML, carry a size and
 * an accessible name, use unique ids, and show the expected markers: two
 * numbered plan steps and three route labels on the map.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Parse an SVG file, failing the test if it is not well-formed XML. */
function parseSvg(path: string): Document {
  const doc = new DOMParser().parseFromString(readFileSync(path, "utf8"), "image/svg+xml");
  expect(doc.querySelector("parsererror"), `${path} must parse as XML`).toBeNull();
  return doc;
}

const MAP = "docs/images/map.svg";
const CARD = "docs/images/trail-card.svg";

describe("readme images are well-formed labelled SVGs", () => {
  it.each([MAP, CARD])("%s has a size, a viewBox and an accessible name", (path) => {
    const root = parseSvg(path).documentElement;
    expect(root.tagName).toBe("svg");
    expect(root.getAttribute("width"), "width").toBeTruthy();
    expect(root.getAttribute("height"), "height").toBeTruthy();
    expect(root.getAttribute("viewBox"), "viewBox").toBeTruthy();
    expect(root.getAttribute("aria-label"), "aria-label").toBeTruthy();
  });
  it("the trail card is exposed as one image with a name", () => {
    const root = parseSvg(CARD).documentElement;
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toContain("Trail card");
  });
  it.each([MAP, CARD])("%s contains no id twice", (path) => {
    const ids = [...parseSvg(path).querySelectorAll("[id]")].map((el) => el.getAttribute("id"));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("the map contains exactly 2 numbered step markers", () => {
    const steps = [...parseSvg(MAP).querySelectorAll(".plan-step__n")].map((el) =>
      (el.textContent ?? "").trim(),
    );
    expect(steps).toEqual(["1", "2"]);
  });
  it("the map contains 3 route labels: Climb, Jump, Pivot", () => {
    const labels = [...parseSvg(MAP).querySelectorAll(".map-title")].map((el) =>
      (el.textContent ?? "").trim(),
    );
    expect(labels).toEqual(["Climb", "Jump", "Pivot"]);
  });
});

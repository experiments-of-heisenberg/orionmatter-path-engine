/** Trail-card edges: odd ladders, short sheets, title sizes in the real SVG, file names, pills. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrailCard } from "../src/components/TrailCard";
import type { ClientSheet } from "../src/lib/api/serialize";
import type { PrivacyAssessment } from "../src/lib/privacy";
import { SAMPLE_PERSON, type Person } from "../src/ui/sample";
import {
  CARD_WIDTH,
  cardFileName,
  cardText,
  titleFontSize,
  trailCardModel,
  type TrailCardModel,
} from "../src/ui/trailCard";
import { exploreFor } from "./helpers/ui";
import { assessed } from "./helpers/privacy";

const sheet = exploreFor().data;
const ladderOf = (rungs: PrivacyAssessment["ladder"], k: number) => ({ ladder: rungs, k });

describe("odd ladders", () => {
  it("states: passes that are not a prefix still stop the card at the first failure", () => {
    const model = trailCardModel(
      SAMPLE_PERSON,
      sheet,
      ladderOf(
        [
          { added: "role", label: "backend", shared: "backend", size: 197, passes: true },
          { added: "level", label: "L5", shared: "backend, L5", size: 5, passes: false },
          { added: "goal", label: "goal L6", shared: "backend, L5, goal L6", size: 68, passes: true },
        ],
        10,
      ),
    );
    expect(model.shown).toEqual(["Backend"]);
    expect(model.withheld).toEqual([
      "Senior Engineer (withheld to keep you in a crowd of 10 or more)",
      "Goal: Staff Engineer (withheld to keep you in a crowd of 10 or more)",
    ]);
    expect(model.crowd).toBe(197);
    expect(model.title).toBe("My routes to the next level");
  });

  it("an empty ladder shows nothing, withholds nothing, and names no goal", () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, ladderOf([], 10));
    expect(model.shown).toEqual([]);
    expect(model.withheld).toEqual([]);
    expect(model.crowd).toBeNull();
    expect(model.title).toBe("My routes to the next level");
    expect(() => renderToStaticMarkup(createElement(TrailCard, { model }))).not.toThrow();
  });

  it("a company type whose own name contains a comma is shown whole (review fix: it used to show only the part after the comma)", () => {
    const model = trailCardModel(
      SAMPLE_PERSON,
      sheet,
      ladderOf(
        [
          { added: "role", label: "backend", shared: "backend", size: 197, passes: true },
          {
            added: "company type",
            label: "big, tech co",
            shared: "backend, L5, big, tech co",
            size: 50,
            passes: true,
          },
        ],
        10,
      ),
    );
    expect(model.shown).toEqual(["Backend", "big, tech co"]);
  });

  it("k 1 shows every detail; a k beyond the server's range withholds everything", async () => {
    const small = trailCardModel(SAMPLE_PERSON, sheet, await assessed({ k: 1 }));
    expect(small.shown).toEqual(["Backend", "Senior Engineer", "Goal: Staff Engineer", "South India"]);
    const huge = trailCardModel(
      SAMPLE_PERSON,
      sheet,
      ladderOf(
        (await assessed()).ladder.map((r) => ({ ...r, passes: false })),
        10000,
      ),
    );
    expect(huge.shown).toEqual([]);
    expect(huge.crowd).toBeNull();
    expect(huge.withheld).toHaveLength(4);
  });
});

describe("sheets with fewer than three routes", () => {
  it("states: the card carries whatever routes there are, and the SVG still renders", async () => {
    const privacy = await assessed();
    const one: ClientSheet = { ...sheet, routes: sheet.routes.slice(0, 1) };
    const single = trailCardModel(SAMPLE_PERSON, one, privacy);
    expect(single.routes).toHaveLength(1);
    expect(single.routes[0]?.label).toBe("Climb");
    const html = renderToStaticMarkup(createElement(TrailCard, { model: single }));
    expect(html).toContain('viewBox="0 0 1200 630"');
    expect(html).toContain(single.footer);

    const none: ClientSheet = { ...sheet, routes: [] };
    const empty = trailCardModel(SAMPLE_PERSON, none, privacy);
    expect(empty.routes).toEqual([]);
    expect(empty.axisMax).toBe(36);
    const bare = renderToStaticMarkup(createElement(TrailCard, { model: empty }));
    expect(bare).toContain("My route to Staff Engineer");
    expect(bare).toContain(empty.footer);
  });
});

describe("title sizes in the real SVG", () => {
  const titleOf = (length: number): string => `My route to ${"x".repeat(length - "My route to ".length)}`;

  it.each([
    [24, 60],
    [25, 48],
    [36, 48],
    [37, 38],
    [60, 38],
  ])("a %i-character title renders at font-size %i", async (length, size) => {
    expect(titleFontSize(titleOf(length))).toBe(size);
    const label = "x".repeat(length - "My route to ".length);
    const person: Person = { ...SAMPLE_PERSON, goal: { targetLevel: "L6", label } };
    const model = trailCardModel(person, sheet, await assessed());
    expect(model.title).toHaveLength(length);
    const html = renderToStaticMarkup(createElement(TrailCard, { model }));
    expect(html).toContain(`font-size="${size}"`);
    expect(html).toContain(model.title);
  });

  // Title width estimate: length x 0.55 x fontSize against the 1056 px text column (1200 - 2x72).
  // 24 chars @60 = 792 px (fits); 25 @48 = 660 (fits); 36 @48 = 950.4 (fits);
  // 37 @38 = 773.3 (fits); 60 @38 = 1254 (OVERFLOWS by ~198 px). Only the 60-char title overflows.
  it("24 and 36-character titles fit the card; longer ones are reported, never failed", () => {
    for (const length of [24, 36]) {
      const width = length * 0.55 * titleFontSize(titleOf(length));
      expect(width).toBeLessThanOrEqual(1056);
    }
    const reports: string[] = [];
    for (const length of [37, 60]) {
      const width = length * 0.55 * titleFontSize(titleOf(length));
      if (width > 1056)
        reports.push(
          `REPORT: a ${length}-character title at ${width.toFixed(0)} px would overflow the card.`,
        );
    }
    for (const report of reports) console.log(report);
  });
});

describe("cardFileName with odd titles", () => {
  it("emoji, RTL text, 200 characters and punctuation-only titles all give safe names", async () => {
    const model: TrailCardModel = trailCardModel(SAMPLE_PERSON, sheet, await assessed());
    expect(cardFileName({ ...model, title: "My 🎉 route" }, "png")).toBe("my-route.png");
    expect(cardFileName({ ...model, title: "مسار وظيفي" }, "png")).toBe("trail-card.png");
    expect(cardFileName({ ...model, title: "x".repeat(200) }, "png")).toBe(`${"x".repeat(50)}.png`);
    expect(cardFileName({ ...model, title: "!!!???..." }, "svg")).toBe("trail-card.svg");
  });
});

describe("the Start here pill", () => {
  it.each(["climb", "jump", "pivot"] as const)(
    "stays inside the card when %s is recommended",
    async (start) => {
      const privacy = await assessed();
      const ranked: ClientSheet = { ...sheet, ranking: { ...sheet.ranking, recommended: start } };
      const html = renderToStaticMarkup(
        createElement(TrailCard, { model: trailCardModel(SAMPLE_PERSON, ranked, privacy) }),
      );
      const match = /<rect[^>]*x="([\d.]+)"[^>]*width="128"/.exec(html);
      expect(match?.[1]).toBeDefined();
      const x = Number(match?.[1]);
      expect(x).toBeGreaterThan(0);
      expect(x + 128).toBeLessThanOrEqual(CARD_WIDTH);
    },
  );
});

describe("nothing withheld appears anywhere", () => {
  it("states: the card stops at the first failure, and withheld goal/region words reach no output", () => {
    const person: Person = {
      ...SAMPLE_PERSON,
      profile: { ...SAMPLE_PERSON.profile, roleFamily: "sre", level: "ZEBRA-9", region: "ZZ-QuasarReg" },
      goal: { targetLevel: "L6", label: "Quasar Warden" },
    };
    const model = trailCardModel(
      person,
      sheet,
      ladderOf(
        [
          { added: "role", label: "sre", shared: "sre", size: 120, passes: true },
          { added: "level", label: "ZEBRA-9", shared: "sre, ZEBRA-9", size: 40, passes: true },
          { added: "goal", label: "goal L6", shared: "sre, ZEBRA-9, goal L6", size: 8, passes: false },
          {
            added: "region",
            label: "ZZ-QuasarReg",
            shared: "sre, ZEBRA-9, goal L6, ZZ-QuasarReg",
            size: 3,
            passes: false,
          },
        ],
        10,
      ),
    );
    expect(model.shown).toEqual(["SRE", "ZEBRA-9"]);
    expect(model.withheld).toHaveLength(2);
    const html = renderToStaticMarkup(createElement(TrailCard, { model }));
    const text = cardText(model);
    const png = cardFileName(model, "png");
    const svg = cardFileName(model, "svg");
    for (const secret of ["Quasar", "Warden", "ZZ-QuasarReg"]) {
      expect(html).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    const aria = /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(aria).not.toContain("Quasar");
    expect(aria).not.toContain("Warden");
    for (const secret of ["quasar", "warden", "zz-quasarreg", "quasarreg"]) {
      expect(png).not.toContain(secret);
      expect(svg).not.toContain(secret);
    }
    // Sanity: what the ladder allows IS there.
    expect(html).toContain("SRE");
    expect(html).toContain("ZEBRA-9");
    expect(text).toContain("SRE");
  });
});

describe("cardText with no details and no limit", () => {
  it("states: the title, two blank lines, the routes, and the footer", () => {
    const person: Person = { ...SAMPLE_PERSON, constraints: { riskTolerance: "medium", addSkills: [] } };
    const model = trailCardModel(person, sheet, ladderOf([], 10));
    expect(model.limit).toBeUndefined();
    const lines = cardText(model).split("\n");
    expect(lines[0]).toBe("My routes to the next level");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("");
    expect(lines.filter((l) => l.includes("(start here)"))).toHaveLength(1);
    expect(lines.at(-1)).toBe("Synthetic cohort of 484 engineers. Ranges, not promises.");
  });
});

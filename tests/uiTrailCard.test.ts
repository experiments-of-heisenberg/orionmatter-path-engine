/** The trail card's decisions: what is shown, what is withheld, and the words. */
import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardFileName,
  cardText,
  titleFontSize,
  trailCardModel,
} from "../src/ui/trailCard";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { embeddedPerson, exploreFor } from "./helpers/ui";
import { assessed } from "./helpers/privacy";

const sheet = exploreFor().data;

describe("what is shown follows the privacy ladder", () => {
  it("at k=10 for the sample person every detail passes: role, level, goal and region, with the crowd they leave", async () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed());
    expect(model.shown).toEqual(["Backend", "Senior Engineer", "Goal: Staff Engineer", "South India"]);
    expect(model.withheld).toEqual([]);
    expect(model.crowd).toBe(11);
    expect(model.title).toBe("My route to Staff Engineer");
    expect(model.k).toBe(10);
  });

  it("at k=70 the goal and the region fall below the crowd: they are withheld, named as withheld, and the title stops naming the goal", async () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed({ k: 70 }));
    expect(model.shown).toEqual(["Backend", "Senior Engineer"]);
    expect(model.withheld).toEqual([
      "Goal: Staff Engineer (withheld to keep you in a crowd of 70 or more)",
      "South India (withheld to keep you in a crowd of 70 or more)",
    ]);
    expect(model.crowd).toBe(93);
    expect(model.title).toBe("My routes to the next level");
    expect(JSON.stringify(model)).not.toContain('Staff Engineer"');
  });

  it("when even the first detail is too common to hide in, nothing personal is shown and there is no crowd", async () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed({ k: 500 }));
    expect(model.shown).toEqual([]);
    expect(model.crowd).toBeNull();
    expect(model.withheld).toHaveLength(4);
    expect(model.title).toBe("My routes to the next level");
  });

  it("a company type that drops the crowd below k is withheld like any other detail", async () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed({ companyType: "robotics", k: 10 }));
    expect(model.shown).toEqual(["Backend", "Senior Engineer", "Goal: Staff Engineer", "South India"]);
    expect(model.withheld).toEqual(["robotics (withheld to keep you in a crowd of 10 or more)"]);
  });

  it("never shows years of experience, technologies, constraints other than the time limit, or the pay band", async () => {
    const person = {
      ...SAMPLE_PERSON,
      profile: { ...SAMPLE_PERSON.profile, yearsExperience: 7.5, compBand: "B4", stack: ["secretlang"] },
      constraints: { riskTolerance: "high" as const, addSkills: ["hidden"], minCompBand: "B5", remote: true },
    };
    const model = trailCardModel(person, sheet, await assessed());
    const all = JSON.stringify(model) + cardText(model);
    for (const secret of ["7.5", "B4", "B5", "secretlang", "hidden", "remote", "high"])
      expect(all).not.toContain(secret);
  });

  it("shows the time limit when there is one, and the routes use the limits", async () => {
    const limited = exploreFor({ maxMonths: 24 });
    const model = trailCardModel(limited.person, limited.data, await assessed());
    expect(model.limit).toBe("Within 24 months");
    expect(model.routes.map((r) => [r.label, r.status, r.startHere])).toEqual([
      ["Climb", "none_within_limits", false],
      ["Jump", "ok", true],
      ["Pivot", "none_within_limits", false],
    ]);
    expect(model.routes[0]?.time).toBe("None within these limits");
    expect(model.routes[0]?.window).toBeNull();
    expect(model.routes[0]?.median).toBeNull();
    expect(model.axisMax).toBeGreaterThanOrEqual(36);
  });
});

describe("routes on the card", () => {
  it("are ranges with engineer counts, one 'start here', and limited evidence said in words", async () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed());
    expect(model.routes.map((r) => r.time)).toEqual([
      "34\u201340 months",
      "18\u201323 months",
      "42\u201349 months",
    ]);
    expect(model.routes[0]?.evidence).toBe("74\u201392% \u00b7 55 engineers");
    expect(model.routes.filter((r) => r.startHere)).toHaveLength(1);
    const thin = exploreFor({}, embeddedPerson());
    const thinModel = trailCardModel(thin.person, thin.data, await assessed({}, [], thin.person));
    expect(thinModel.routes.some((r) => r.evidence.endsWith("limited evidence"))).toBe(true);
  });

  it("a route with no comparable engineers says so and has no figures", async () => {
    const none = exploreFor({}, { ...SAMPLE_PERSON, goal: { targetLevel: "EM2", label: "Director" } });
    const model = trailCardModel(none.person, none.data, await assessed({}, [], none.person));
    for (const r of model.routes) {
      expect(r.time).toBe("No comparable engineers");
      expect(r.evidence).toBe("");
      expect(r.window).toBeNull();
    }
  });

  it("the axis runs to whole years and covers the longest route and the person's limit", async () => {
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed());
    expect(model.axisMax % 12).toBe(0);
    expect(model.axisMax).toBeGreaterThanOrEqual(49);
    const far = exploreFor({ maxMonths: 100 });
    expect(trailCardModel(far.person, far.data, await assessed()).axisMax).toBeGreaterThanOrEqual(100);
  });
});

describe("the words", () => {
  it("cardText lists the title, details, limit, each route, and the honest footer", async () => {
    const limited = exploreFor({ maxMonths: 36 });
    const text = cardText(trailCardModel(limited.person, limited.data, await assessed()));
    expect(text.split("\n")[0]).toBe("My route to Staff Engineer");
    expect(text).toContain("Backend \u00b7 Senior Engineer \u00b7 Goal: Staff Engineer \u00b7 South India");
    expect(text).toContain("Within 36 months");
    expect(text).toMatch(/Jump \(start here\): 18\u201323 months\. \d+\u2013\d+% \u00b7 65 engineers/);
    expect(text).toContain("Synthetic cohort of 484 engineers. Ranges, not promises.");
  });
  it("title size shrinks for long titles, and file names are safe", async () => {
    expect(titleFontSize("short")).toBe(60);
    expect(titleFontSize("x".repeat(30))).toBe(48);
    expect(titleFontSize("x".repeat(60))).toBe(38);
    const model = trailCardModel(SAMPLE_PERSON, sheet, await assessed());
    expect(cardFileName(model, "png")).toBe("my-route-to-staff-engineer.png");
    expect(cardFileName({ ...model, title: "../../etc/passwd <script>" }, "svg")).toBe(
      "etc-passwd-script.svg",
    );
    expect(cardFileName({ ...model, title: "\u2605\u2605" }, "png")).toBe("trail-card.png");
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(1200 / 630);
  });
});

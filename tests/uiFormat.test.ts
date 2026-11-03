/** Tests for the interface's wording: ranges, statuses and the plain sentences, against real route data. */
import { describe, expect, it } from "vitest";
import {
  ARCHETYPE_BLURB,
  ARCHETYPE_LABEL,
  bandRange,
  engineersText,
  monthsRange,
  percentRange,
  roundedShares,
  routeAriaLabel,
  routeStatus,
  statusBadge,
  summaryLine,
} from "../src/ui/format";
import { embeddedPerson, exploreFor } from "./helpers/ui";

const route = (data: ReturnType<typeof exploreFor>["data"], a: "climb" | "jump" | "pivot") =>
  data.routes.find((r) => r.archetype === a)!;

describe("ranges and counts", () => {
  it("writes months and percent ranges with an en dash", () => {
    expect(monthsRange([34, 40])).toBe("34\u201340 months");
    expect(monthsRange(null)).toBe("No one reached it");
    expect(percentRange([0.74, 0.92])).toBe("74\u201392%");
    expect(percentRange([0, 0.07])).toBe("0\u20137%");
    expect(percentRange([0.045, 0.955])).toBe("5\u201396%");
  });

  it("pluralises engineers", () => {
    expect(engineersText(1)).toBe("1 comparable engineer");
    expect(engineersText(0)).toBe("0 comparable engineers");
    expect(engineersText(55)).toBe("55 comparable engineers");
  });

  it("writes a band range, a single band, and a dash for no data", () => {
    expect(bandRange(["B4", "B5"])).toBe("B4\u2013B5");
    expect(bandRange(["B5", "B5"])).toBe("B5");
    expect(bandRange(["-", "-"])).toBe("\u2014");
  });

  it("has a label and a sentence for every route", () => {
    expect(ARCHETYPE_LABEL).toEqual({ climb: "Climb", jump: "Jump", pivot: "Pivot" });
    for (const text of Object.values(ARCHETYPE_BLURB)) expect(text.length).toBeGreaterThan(10);
  });
});

describe("routeStatus, statusBadge and summaryLine with real data", () => {
  it("an ordinary route is ok, has no badge, and reads as one plain sentence", () => {
    const { data } = exploreFor();
    const climb = route(data, "climb");
    expect(routeStatus(climb)).toBe("ok");
    expect(statusBadge("ok")).toBeUndefined();
    expect(summaryLine(climb)).toBe(
      "Usually 34\u201340 months. 74\u201392% got there. Based on 55 engineers.",
    );
    expect(routeAriaLabel(climb)).toBe(
      "Climb route. Usually 34\u201340 months. 74\u201392% got there. Based on 55 engineers.",
    );
  });

  it("a thin route is 'limited' and says so in the badge and the sentence", () => {
    const { data } = exploreFor({}, embeddedPerson());
    const thin = data.routes.find((r) => r.evidenceThin && r.reachedN > 0)!;
    expect(routeStatus(thin)).toBe("limited");
    expect(statusBadge("limited")).toBe("Limited evidence");
    expect(summaryLine(thin)).toMatch(/ Limited evidence\.$/);
  });

  it("under a 24-month limit climb and pivot are 'none within limits' and say what the fastest engineer took", () => {
    const { data } = exploreFor({ maxMonths: 24 });
    expect(routeStatus(route(data, "climb"))).toBe("none_within_limits");
    expect(routeStatus(route(data, "jump"))).toBe("ok");
    expect(statusBadge("none_within_limits")).toBe("None within your limits");
    expect(summaryLine(route(data, "climb"))).toBe(
      "No comparable engineer reached it within your limits (55 comparable engineers). The fastest took 30 months.",
    );
  });

  it("a route nobody is comparable on is 'no_data'", () => {
    const person = { ...exploreFor().person, goal: { targetLevel: "EM2", label: "Director" } };
    const { data } = exploreFor({}, person);
    for (const r of data.routes) {
      expect(routeStatus(r)).toBe("no_data");
      expect(summaryLine(r)).toContain("no evidence for this route");
    }
    expect(statusBadge("no_data")).toBe("No comparable engineers");
  });
});

describe("roundedShares", () => {
  it("always adds to exactly 100 for any shares, using the largest remainder", () => {
    for (let i = 0; i < 300; i++) {
      const raw = Array.from({ length: 2 + (i % 4) }, (_, k) => ((i * 31 + k * 17) % 97) + 1);
      expect(roundedShares(raw).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("matches the obvious cases and never goes negative", () => {
    expect(roundedShares([0.85, 0.09, 0.05])).toEqual([86, 9, 5]);
    expect(roundedShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(roundedShares([0, 0, 0])).toEqual([0, 0, 0]);
    expect(roundedShares([])).toEqual([]);
    expect(roundedShares([0.6, 0.4]).every((v) => v >= 0)).toBe(true);
  });
});

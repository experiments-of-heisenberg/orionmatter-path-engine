/** Edge cases for the "what changed" chips: mismatched sheets, threshold corners, ordering, and wording hygiene. */
import { describe, expect, it } from "vitest";
import type { ClientRoute, ClientSheet } from "../src/lib/api/serialize";
import { MONTHS_SHIFT_MIN, RATE_SHIFT_MIN, deltaChips, routeChip } from "../src/ui/delta";
import type { Archetype } from "../src/ui/format";
import { exploreFor } from "./helpers/ui";

const noLimit = exploreFor().data;
const template = noLimit.routes.find((r) => r.archetype === "climb") as ClientRoute;

/** A route with hand-set figures on top of a real route's shape. */
function made(overrides: Partial<ClientRoute>): ClientRoute {
  return { ...template, ...overrides };
}

/** A copy of a route with its success range and window moved by the given amounts. */
function moved(route: ClientRoute, ratePoints: number, months: number): ClientRoute {
  return made({
    n: route.n,
    reachedN: route.reachedN,
    reachedRate: [route.reachedRate[0] + ratePoints / 100, route.reachedRate[1] + ratePoints / 100],
    monthsToGoal: route.monthsToGoal
      ? [route.monthsToGoal[0] + months, route.monthsToGoal[1] + months]
      : null,
  });
}

const without = (sheet: ClientSheet, archetype: Archetype): ClientSheet => ({
  ...sheet,
  routes: sheet.routes.filter((r) => r.archetype !== archetype),
});

describe("sheets whose route lists differ", () => {
  it("skips a route missing on either side instead of throwing", () => {
    const limited = exploreFor({ maxMonths: 24 }).data;
    const afterGone = deltaChips(noLimit, without(limited, "pivot"));
    expect(afterGone.map((c) => c.id)).not.toContain("route-pivot");
    const beforeGone = deltaChips(without(noLimit, "jump"), limited);
    expect(beforeGone.map((c) => c.id)).not.toContain("route-jump");
    // Only routes present on both sides are compared; one-sided routes vanish silently.
  });

  it("recommended null on both sides yields no chip at all", () => {
    const none = exploreFor({ maxMonths: 12 }).data;
    expect(none.ranking.recommended).toBeNull();
    expect(deltaChips(none, none)).toEqual([]);
  });

  it("recommended unchanged but a route moved: route chips only, no recommendation chip", () => {
    const after: ClientSheet = {
      ...noLimit,
      routes: noLimit.routes.map((r) => (r.archetype === "climb" ? moved(r, -10, 0) : r)),
    };
    const chips = deltaChips(noLimit, after);
    expect(chips.map((c) => c.id)).toEqual(["route-climb"]);
  });
});

describe("threshold corners", () => {
  it("exactly at both thresholds with opposite signs is 'mixed' and says both", () => {
    for (const chip of [
      routeChip(template, moved(template, 5, 3)),
      routeChip(template, moved(template, -5, -3)),
    ]) {
      expect(chip?.tone).toBe("mixed");
      expect(chip?.text).toContain("success ");
      expect(chip?.text).toContain("time ");
    }
  });

  it("a window of [x, x] reads fine, and a null median changes nothing", () => {
    const before = made({ monthsToGoal: [30, 30], monthsMedian: null });
    const after = made({ monthsToGoal: [34, 34], monthsMedian: null });
    expect(routeChip(before, after)?.text).toContain("time 30\u201330 months to 34\u201334 months");
    expect(routeChip(before, before)).toBeNull();
  });
});

describe("chip identity and order", () => {
  const sheets = [6, 12, 24, 36, 48, 72].map((maxMonths) => exploreFor({ maxMonths }).data);

  it("ids are unique within one result", () => {
    for (const sheet of sheets) {
      for (const chips of [deltaChips(noLimit, sheet), deltaChips(sheet, noLimit)]) {
        const ids = chips.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it("the recommendation comes first, then routes in the sheet's own order", () => {
    for (const sheet of sheets) {
      for (const [before, after] of [
        [noLimit, sheet],
        [sheet, noLimit],
      ] as const) {
        const chips = deltaChips(before, after);
        if (chips.some((c) => c.id === "recommended")) expect(chips[0]?.id).toBe("recommended");
        const order = after.routes.map((r) => r.archetype);
        const seen = chips.filter((c) => c.id !== "recommended").map((c) => c.id);
        const inOrder = order.map((a) => `route-${a}`).filter((id) => seen.includes(id));
        expect(seen).toEqual(inOrder);
      }
    }
  });
});

describe("wording hygiene", () => {
  it("no chip text ever contains 'NaN', 'undefined' or 'null' across the whole slider range", () => {
    for (let maxMonths = 6; maxMonths <= 72; maxMonths += 6) {
      const sheet = exploreFor({ maxMonths }).data;
      for (const chips of [deltaChips(noLimit, sheet), deltaChips(sheet, noLimit)]) {
        for (const chip of chips) {
          expect(chip.text).not.toContain("NaN");
          expect(chip.text).not.toContain("undefined");
          expect(chip.text).not.toContain("null");
        }
      }
    }
  });

  it("says '1 engineer' for a single engineer", () => {
    const before = made({ n: 55, reachedN: 47 });
    const after = made({ n: 1, reachedN: 1, reachedRate: [0.64, 0.82] });
    expect(routeChip(before, after)?.text.endsWith("now based on 1 engineer.")).toBe(true);
  });

  it("the smallest reportable moves read plural: '5 points', '3 months'", () => {
    // Reported: the singular branches ("1 point", "1 month") cannot be reached, because a move
    // must be at least 5 points or 3 months to be reported at all. The wording helpers still
    // handle singulars correctly (see "1 engineer" above); the dead branches are harmless.
    expect(routeChip(template, moved(template, RATE_SHIFT_MIN, 0))?.text).toContain("up 5 points");
    expect(routeChip(template, moved(template, 0, MONTHS_SHIFT_MIN))?.text).toContain(
      "slower by about 3 months",
    );
  });
});

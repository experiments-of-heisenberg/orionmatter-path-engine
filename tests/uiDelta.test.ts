/** "What changed" chips: the words, the thresholds, and agreement with the server's own diff. */
import { describe, expect, it } from "vitest";
import type { ClientRoute } from "../src/lib/api/serialize";
import { MONTHS_SHIFT_MIN as SERVER_MONTHS, RATE_SHIFT_MIN as SERVER_RATE } from "../src/lib/whatif";
import { MONTHS_SHIFT_MIN, RATE_SHIFT_MIN, deltaChips, routeChip } from "../src/ui/delta";
import { exploreFor } from "./helpers/ui";

const start = exploreFor().data;
const limited = exploreFor({ maxMonths: 24 }).data;
const climb = start.routes.find((r) => r.archetype === "climb") as ClientRoute;

/** A copy of a route with its success range and window moved by the given amounts. */
function moved(route: ClientRoute, ratePoints: number, months: number): ClientRoute {
  return {
    ...route,
    reachedRate: [route.reachedRate[0] + ratePoints / 100, route.reachedRate[1] + ratePoints / 100],
    monthsToGoal: route.monthsToGoal
      ? [route.monthsToGoal[0] + months, route.monthsToGoal[1] + months]
      : null,
  };
}

describe("thresholds", () => {
  it("match the server's, so the chip and the What-if agent's sentence agree about what is worth saying", () => {
    expect(RATE_SHIFT_MIN).toBe(SERVER_RATE);
    expect(MONTHS_SHIFT_MIN).toBe(SERVER_MONTHS);
  });

  it("a move just under a threshold says nothing, and one at it says something", () => {
    expect(routeChip(climb, moved(climb, 4.9, 0))).toBeNull();
    expect(routeChip(climb, moved(climb, 0, 2.9))).toBeNull();
    expect(routeChip(climb, moved(climb, RATE_SHIFT_MIN, 0))?.text).toContain("up 5 points");
    expect(routeChip(climb, moved(climb, 0, -MONTHS_SHIFT_MIN))?.text).toContain("faster by about 3 months");
  });
});

describe("routeChip", () => {
  it("says nothing when nothing moved", () => {
    expect(routeChip(climb, climb)).toBeNull();
  });

  it("success down and time slower is 'worse' and says both, with arrows in words and the new count", () => {
    const chip = routeChip(climb, moved(climb, -10, 6));
    expect(chip?.tone).toBe("worse");
    expect(chip?.text).toMatch(/success 74\u201392% to 64\u201382% \(down 10 points\)/);
    expect(chip?.text).toMatch(/slower by about 6 months/);
    expect(chip?.text).toContain(`now based on ${climb.n} engineers`);
  });

  it("success up and time slower is 'mixed'", () => {
    expect(routeChip(climb, moved(climb, 8, 6))?.tone).toBe("mixed");
  });

  it("a route nobody finishes within the limits any more is reported with what it was", () => {
    const gone = { ...climb, reachedN: 0 };
    const chip = routeChip(climb, gone);
    expect(chip?.tone).toBe("worse");
    expect(chip?.text).toContain("no one finished within your limits now");
    expect(chip?.text).toContain("74\u201392%, 55 engineers");
  });

  it("a route that becomes reachable is reported with its new range, window and count", () => {
    const chip = routeChip({ ...climb, reachedN: 0 }, climb);
    expect(chip?.tone).toBe("better");
    expect(chip?.text).toContain(
      "now reachable within your limits, 74\u201392% of 55 engineers (34\u201340 months)",
    );
  });

  it("a route with no data on either side, or unreachable on both, is not reported", () => {
    const empty = { ...climb, n: 0, reachedN: 0 };
    expect(routeChip(empty, empty)).toBeNull();
    expect(routeChip({ ...climb, reachedN: 0 }, { ...climb, reachedN: 0 })).toBeNull();
  });

  it("says 'engineer' for one", () => {
    const one = { ...moved(climb, -10, 0), n: 1 };
    expect(routeChip(climb, one)?.text).toContain("now based on 1 engineer.");
  });

  it("a missing window on one side is a success-only chip, not a crash", () => {
    const chip = routeChip(climb, { ...moved(climb, 10, 0), monthsToGoal: null });
    expect(chip?.text).toContain("success");
    expect(chip?.text).not.toContain("time ");
  });
});

describe("deltaChips on real sheets", () => {
  it("is empty for the same sheet", () => {
    expect(deltaChips(start, start)).toEqual([]);
  });

  it("a 24-month limit: the recommendation moves first, climb and pivot are gone, jump slips", () => {
    const chips = deltaChips(start, limited);
    expect(chips.map((c) => c.id)).toEqual(["recommended", "route-climb", "route-jump", "route-pivot"]);
    expect(chips[0]?.text).toBe("Start-here route is now Jump (it was Climb).");
    expect(chips[1]?.text).toContain("no one finished within your limits now");
    expect(chips[2]?.text).toMatch(/success 56\u201378% to 43\u201367%/);
    expect(chips[3]?.tone).toBe("worse");
  });

  it("going back the other way reports the routes as reachable again", () => {
    const chips = deltaChips(limited, start);
    expect(chips[0]?.text).toBe("Start-here route is now Climb (it was Jump).");
    expect(chips.find((c) => c.id === "route-climb")?.tone).toBe("better");
  });

  it("when no route has anyone who met the limits, says there is no start-here route", () => {
    const none = exploreFor({ maxMonths: 12 }).data;
    const chip = deltaChips(start, none)[0];
    expect(chip?.text).toBe("No route has anyone who met your limits, so there is no start-here route now.");
  });

  it("every chip states its numbers as ranges, never a bare single score", () => {
    for (const chip of deltaChips(start, limited)) expect(chip.text).not.toMatch(/(?<!\u2013)\b\d+%/);
  });
});

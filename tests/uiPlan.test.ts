/** Plan run state: transitions, staleness, the headline, and when steps may go on the map. */
import { describe, expect, it } from "vitest";
import type { ClientPlanRun } from "../src/lib/api/serialize";
import { withLimit } from "../src/ui/limits";
import {
  IDLE_PLAN,
  planFailed,
  planFinished,
  planHeadline,
  planIsStale,
  planProgress,
  planStarted,
  remainingObjections,
  routeOf,
  stepsForMap,
  windowText,
} from "../src/ui/plan";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { approvedPlan } from "./helpers/plan";

const base = SAMPLE_PERSON.constraints;
const rejection = {
  code: "n_mismatch",
  source: "verifier" as const,
  routeIndex: 0,
  claimText: "c",
  reason: "r",
};
const asUnresolved = (run: ClientPlanRun, left = 2, revisions = 2): ClientPlanRun => ({
  ...run,
  status: "unresolved",
  revisions,
  verdicts: [{ approved: false, rejections: Array.from({ length: left }, () => rejection), notes: [] }],
});

describe("transitions", () => {
  it("a run starts empty and tied to its limits, drops any earlier plan, and ignores events when it is not running", async () => {
    const { result } = await approvedPlan();
    const started = planStarted(base);
    expect(started).toMatchObject({ phase: "running", forConstraints: base });
    expect(started.result).toBeUndefined();
    expect(planProgress(IDLE_PLAN, { type: "note", message: "x" })).toBe(IDLE_PLAN);
    const done = planFinished(started, result);
    expect(planProgress(done, { type: "note", message: "late" })).toBe(done);
  });

  it("progress adds to the trace while running", () => {
    const s = planProgress(planStarted(base), { type: "stage", stage: "gathering" });
    expect(s.trace.items).toHaveLength(1);
  });

  it("finishing keeps the trace and the limits; failing keeps the trace, drops any result, and records the message", async () => {
    const { result } = await approvedPlan();
    const running = planProgress(planStarted(base), { type: "stage", stage: "composing" });
    expect(planFinished(running, result)).toMatchObject({ phase: "done", forConstraints: base });
    const failed = planFailed(planFinished(running, result), "The model is busy.");
    expect(failed).toMatchObject({ phase: "error", error: "The model is busy." });
    expect("result" in failed).toBe(false);
    expect(failed.trace.items).toHaveLength(1);
  });
});

describe("staleness", () => {
  it("a plan is stale only when finished and the limits differ from the ones it was made for", async () => {
    const { result } = await approvedPlan();
    const done = planFinished(planStarted(base), result);
    expect(planIsStale(done, base)).toBe(false);
    expect(planIsStale(done, { ...base, remote: false })).toBe(false); // the same limits written differently
    expect(planIsStale(done, withLimit(base, 24))).toBe(true);
    expect(planIsStale(planStarted(base), withLimit(base, 24))).toBe(false); // still running: nothing to be stale
    expect(planIsStale(IDLE_PLAN, base)).toBe(false);
  });
});

describe("the headline never hides a failure", () => {
  it("approved on the first check, after one revision, after several", async () => {
    const { result } = await approvedPlan();
    expect(planHeadline(result)).toBe("The Skeptic approved this plan on its first check.");
    expect(planHeadline({ ...result, revisions: 1 })).toBe(
      "The Skeptic approved this plan after 1 revision.",
    );
    expect(planHeadline({ ...result, revisions: 2 })).toBe(
      "The Skeptic approved this plan after 2 revisions.",
    );
  });
  it("unresolved says how many objections remain and warns, singular and plural", async () => {
    const { result } = await approvedPlan();
    expect(planHeadline(asUnresolved(result, 2, 2))).toBe(
      "The Skeptic did not approve this plan: 2 objections remain after 2 revisions. Read the objections before relying on it.",
    );
    expect(planHeadline(asUnresolved(result, 1, 1))).toBe(
      "The Skeptic did not approve this plan: 1 objection remains after 1 revision. Read the objections before relying on it.",
    );
    expect(remainingObjections(asUnresolved(result, 3))).toBe(3);
    expect(remainingObjections({ ...result, verdicts: [] })).toBe(0);
  });
});

describe("windowText", () => {
  it("says right away, a single month, or a range", () => {
    expect(windowText([0, 0])).toBe("Right away");
    expect(windowText([6, 6])).toBe("Month 6");
    expect(windowText([6, 12])).toBe("Months 6 to 12");
    expect(windowText([0, 20])).toBe("Months 0 to 20");
  });
});

describe("steps on the map", () => {
  it("come only from an approved plan whose limits are the current ones", async () => {
    const { result } = await approvedPlan();
    const done = planFinished(planStarted(base), result);
    expect(stepsForMap(done, base, "jump")?.steps).toEqual(routeOf(result, "jump")?.steps);
    expect(stepsForMap(done, base, "jump")?.archetype).toBe("jump");
  });
  it("are withheld when the plan is unresolved, stale, running, failed or absent", async () => {
    const { result } = await approvedPlan();
    expect(stepsForMap(planFinished(planStarted(base), asUnresolved(result)), base, "climb")).toBeUndefined();
    expect(
      stepsForMap(planFinished(planStarted(base), result), withLimit(base, 24), "climb"),
    ).toBeUndefined();
    expect(stepsForMap(planStarted(base), base, "climb")).toBeUndefined();
    expect(stepsForMap(planFailed(planStarted(base), "x"), base, "climb")).toBeUndefined();
    expect(stepsForMap(IDLE_PLAN, base, "climb")).toBeUndefined();
  });
  it("a route missing from the plan gives nothing, not a crash", async () => {
    const { result } = await approvedPlan();
    const broken = {
      ...result,
      plan: { ...result.plan, routes: result.plan.routes.filter((r) => r.archetype !== "pivot") },
    };
    expect(stepsForMap(planFinished(planStarted(base), broken), base, "pivot")).toBeUndefined();
    expect(routeOf(broken, "pivot")).toBeUndefined();
  });
});

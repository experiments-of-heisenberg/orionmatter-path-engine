/** Plan edges: odd orderings, stale comparisons, headline counts, odd windows, duplicate routes. */
import { describe, expect, it } from "vitest";
import type { ClientPlanRun } from "../src/lib/api/serialize";
import {
  IDLE_PLAN,
  planFailed,
  planFinished,
  planHeadline,
  planIsStale,
  planProgress,
  planStarted,
  stepsForMap,
  windowText,
} from "../src/ui/plan";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { approvedPlan } from "./helpers/plan";

const base = SAMPLE_PERSON.constraints;

describe("transitions in odd orders", () => {
  it("states: finishing before starting still lands in `done`, but with no limits attached", async () => {
    const { result } = await approvedPlan();
    const done = planFinished(IDLE_PLAN, result);
    expect(done.phase).toBe("done");
    expect(done.forConstraints).toBeUndefined();
    expect(done.trace.items).toHaveLength(0);
    // Surprising, and worth stating: with no limits attached the plan below can never be stale,
    // so stepsForMap would show its steps whatever the current limits are. The app never does
    // this (it always starts before it finishes), but a reader of planFinished should know.
    expect(planIsStale(done, { ...base, maxMonths: 24 })).toBe(false);
  });

  it("states: failing after finishing drops the result and records the error, keeping the trace", async () => {
    const { result } = await approvedPlan();
    const done = planFinished(planStarted(base), result);
    const failed = planFailed(done, "The model is busy.");
    expect(failed.phase).toBe("error");
    expect("result" in failed).toBe(false);
    expect(failed).toMatchObject({ error: "The model is busy." });
    expect(failed.trace).toBe(done.trace);
  });

  it("states: finishing twice keeps the later result; progress after the end is ignored", async () => {
    const { result } = await approvedPlan();
    const once = planFinished(planStarted(base), result);
    const twice = planFinished(once, { ...result, revisions: 3 });
    expect(twice.phase).toBe("done");
    expect(twice.result?.revisions).toBe(3);
    expect(planProgress(twice, { type: "note", message: "late" })).toBe(twice);
    expect(planFailed(planStarted(base), "x").phase).toBe("error"); // failing while running is the normal path
  });
});

describe("staleness compares skills strictly", () => {
  it("states: skills in a different order, or a different case, make the plan stale", async () => {
    const { result } = await approvedPlan();
    const done = planFinished(planStarted({ ...base, addSkills: ["go", "rust"] }), result);
    expect(planIsStale(done, { ...base, addSkills: ["go", "rust"] })).toBe(false);
    expect(planIsStale(done, { ...base, addSkills: ["rust", "go"] })).toBe(true);
    expect(planIsStale(done, { ...base, addSkills: ["Go", "rust"] })).toBe(true);
  });
});

describe("the headline counts revisions", () => {
  it("approved after 0, 1 and 5 revisions", async () => {
    const { result } = await approvedPlan();
    expect(planHeadline({ ...result, revisions: 0 })).toBe(
      "The Skeptic approved this plan on its first check.",
    );
    expect(planHeadline({ ...result, revisions: 1 })).toBe(
      "The Skeptic approved this plan after 1 revision.",
    );
    expect(planHeadline({ ...result, revisions: 5 })).toBe(
      "The Skeptic approved this plan after 5 revisions.",
    );
  });

  it("states: an unresolved run with `verdicts: []` says 0 objections remain after 2 revisions", async () => {
    const { result } = await approvedPlan();
    const sentence = planHeadline({ ...result, status: "unresolved", revisions: 2, verdicts: [] });
    expect(sentence).toBe(
      "The Skeptic did not approve this plan: 0 objections remain after 2 revisions. Read the objections before relying on it.",
    );
    // Surprising: "0 objections remain" on a plan the Skeptic did not approve reads as approved.
    // The app never produces this (an unresolved run always carries its last verdict), but the
    // sentence does not defend against an empty verdict list.
  });
});

describe("windowText with odd windows", () => {
  it("states what each prints; reversed and NaN windows read misleadingly", () => {
    expect(windowText([-5, 10])).toBe("Months -5 to 10");
    expect(windowText([1.5, 2.5])).toBe("Months 1.5 to 2.5");
    expect(windowText([12, 6])).toBe("Months 12 to 6"); // misleading: time runs backwards in the sentence
    expect(windowText([Number.NaN, Number.NaN])).toBe("Months NaN to NaN"); // misleading: not a month at all
    expect(windowText([0, Number.NaN])).toBe("Months 0 to NaN");
  });
});

describe("stepsForMap with duplicate archetypes", () => {
  it("states: the first route with that archetype wins", async () => {
    const { result } = await approvedPlan();
    const extra = { ...result.plan.routes[0]!, steps: [] };
    const doubled: ClientPlanRun = {
      ...result,
      plan: { ...result.plan, routes: [...result.plan.routes, extra] },
    };
    const done = planFinished(planStarted(base), doubled);
    expect(stepsForMap(done, base, "climb")?.steps).toBe(result.plan.routes[0]?.steps);
  });
});

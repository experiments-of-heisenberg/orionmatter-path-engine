/** The Plan tab, the Agent Trace and the map markers as static HTML, with a real plan run. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView, TABS, type Tab } from "../src/components/PathApp";
import type { ClientPlanRun } from "../src/lib/api/serialize";
import { withLimit } from "../src/ui/limits";
import { planFailed, planFinished, planProgress, planStarted, type PlanState } from "../src/ui/plan";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { exploreFor } from "./helpers/ui";
import { approvedPlan } from "./helpers/plan";

const count = (html: string, needle: string) => html.split(needle).length - 1;
const base = SAMPLE_PERSON.constraints;
let result: ClientPlanRun;
let done: PlanState;
beforeAll(async () => {
  const run = await approvedPlan();
  result = run.result;
  let s = planStarted(base);
  for (const e of run.events) s = planProgress(s, e);
  done = planFinished(s, result);
});

function view(
  plan: PlanState,
  tab: Tab = "plan",
  constraints: object = {},
  selected: "climb" | "jump" | "pivot" = "climb",
) {
  const { person, data } = exploreFor(constraints);
  return renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab={tab}
      selected={selected}
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
      plan={plan}
    />,
  );
}

describe("before a plan exists", () => {
  const html = view({ phase: "idle", trace: { items: [], finished: false, truncated: false } });
  it("offers to build one, says what it will do and how long it takes, and shows no trace", () => {
    expect(html).toContain("Build my plan");
    expect(html).toContain("about half a minute");
    expect(html).toContain("Muse Spark writes the three routes");
    expect(html).not.toContain("Agent trace");
  });
  it("the Plan tab is selected, with its panel tied to it", () => {
    expect(count(html, 'role="tab"')).toBe(TABS.length);
    expect(html).toMatch(/id="tab-plan"[^>]*aria-selected="true"/);
    expect(html).toMatch(/role="tabpanel" id="panel-plan" aria-labelledby="tab-plan"/);
  });
});

describe("while it runs", () => {
  const running = planProgress(planStarted(base), { type: "stage", stage: "gathering" });
  const html = view(running);
  it("disables the button, announces the stage as a status, and shows the trace so far", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Working/);
    expect(html).toMatch(/role="status">Planner: gathering evidence from the cohort/);
    expect(html).toContain("Agent trace");
    expect(html).toContain("(in progress)");
  });
  it("shows a running call as 'Running' and a finished one as 'Done'", () => {
    const t = planProgress(
      planProgress(running, { type: "tool_call", id: "1", name: "findTwins", args: {}, by: "agent" }),
      { type: "tool_call", id: "2", name: "compBands", args: {}, by: "agent" },
    );
    const h = view(
      planProgress(t, {
        type: "tool_result",
        id: "1",
        name: "findTwins",
        summary: "150 twins",
        isError: false,
        by: "agent",
        evidenceId: "e1",
      }),
    );
    expect(h).toContain("Running");
    expect(h).toContain("Done");
    expect(h).toContain("Chosen by Muse Spark");
    expect(h).toContain("150 twins");
  });
});

describe("an approved plan", () => {
  let html = "";
  beforeAll(() => {
    html = view(done);
  });
  it("says so, shows the selected route's steps with windows, claims with their counts and evidence ids", () => {
    expect(html).toContain("The Skeptic approved this plan on its first check.");
    expect(html).toContain("plan__verdict--approved");
    expect(html).toContain('aria-label="Steps on the Climb route"');
    expect(count(html, 'class="plan-stepcard"')).toBe(2);
    expect(html).toContain("Months 0 to 20");
    expect(html).toMatch(/Based on 55 engineers\./);
    expect(html).toMatch(/<code class="evidence-chip" title="[^"]+">\w+<\/code>/);
    expect(html).toContain("What this plan cannot tell you");
  });
  it("the route buttons say which route is shown", () => {
    expect(html).toMatch(/aria-pressed="true"[^>]*>Climb<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Jump<\/button>/);
  });
  it("shows the Agent trace with who did what, and the approving verdict in words", () => {
    expect(html).toContain("Filled in by code");
    expect(html).toContain("First check: approved, no objections remain");
    expect(html).toContain("5 evidence lookups, 5 filled in by code, 1 Skeptic check, 0 revisions.");
  });
  it("is not stale for the limits it was made for, and the button offers to build it again", () => {
    expect(html).not.toContain("made for earlier limits");
    expect(html).toContain("Build it again");
  });
  it("is stale, and says so with a rebuild button, when the limits have moved", () => {
    const h = view(done, "plan", { maxMonths: 24 });
    expect(h).toContain("This plan was made for earlier limits.");
    expect(h).toContain("Build it for your current limits");
  });
});

describe("steps on the map", () => {
  it("an approved plan numbers the selected route's steps, hidden from screen readers, on both map sizes", () => {
    const html = view(done, "map");
    expect(count(html, 'class="plan-steps" aria-hidden="true"')).toBe(2);
    expect(count(html, 'class="plan-step"')).toBe(4);
    expect(html).toMatch(/class="plan-step__n"[^>]*>1<\/text>/);
  });
  it("the What if tab shows them too", () => {
    expect(count(view(done, "whatif"), 'class="plan-step"')).toBe(4);
  });
  it("no steps without a plan, for a stale plan, or for an unresolved one", () => {
    expect(view({ phase: "idle", trace: done.trace }, "map")).not.toContain("plan-step");
    expect(view(done, "map", { maxMonths: 24 })).not.toContain("plan-step");
    const unresolved = planFinished(planStarted(base), { ...result, status: "unresolved" });
    expect(view(unresolved, "map")).not.toContain("plan-step");
  });
  it("another selected route moves the markers to that route", () => {
    expect(count(view(done, "map", {}, "jump"), 'class="plan-step"')).toBe(4);
  });
});

describe("an unresolved plan is never dressed up", () => {
  const rejection = {
    code: "n_mismatch",
    source: "verifier" as const,
    routeIndex: 0,
    claimText: "Twins took 20 months (n=99)",
    reason: "n does not match the evidence",
  };
  let html = "";
  beforeAll(() => {
    const unresolved: ClientPlanRun = {
      ...result,
      status: "unresolved",
      revisions: 2,
      verdicts: [{ approved: false, rejections: [rejection], notes: [] }],
    };
    const trace = planProgress(planStarted(base), {
      type: "verdict",
      round: 2,
      approved: false,
      rejections: [rejection],
      notes: ["still wrong"],
    });
    html = view(planFinished(trace, unresolved));
  });
  it("uses the warning style and says how many objections remain", () => {
    expect(html).toContain("plan__verdict--unresolved");
    expect(html).toContain("did not approve this plan: 1 objection remains after 2 revisions");
    expect(html).not.toContain("approved this plan");
  });
  it("shows the objection with the exact words objected to and the reason", () => {
    expect(html).toContain("Sample size does not match the evidence");
    expect(html).toContain("Twins took 20 months (n=99)");
    expect(html).toContain("n does not match the evidence");
    expect(html).toContain("Check after revision 2: 1 objection");
  });
  it("does not say the steps are on the map", () => {
    expect(html).not.toContain("numbered on the Map tab");
  });
});

describe("failure", () => {
  it("shows an alert with the message and a Try again button, and keeps the trace so far", () => {
    const failed = planFailed(
      planProgress(planStarted(base), { type: "stage", stage: "gathering" }),
      "The model is busy.",
    );
    const html = view(failed);
    expect(html).toMatch(/role="alert"><p>The model is busy\.<\/p>/);
    expect(html).toContain("Try again");
    expect(html).toContain("Planner: gathering evidence from the cohort");
  });
});

describe("hygiene", () => {
  it("escapes everything the plan and the Skeptic wrote", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const route = {
      ...result.plan.routes[0],
      summary: evil,
      steps: result.plan.routes[0]?.steps.map((s) => ({ ...s, what: evil })),
    };
    const plan = {
      ...result,
      plan: { ...result.plan, routes: [route, ...result.plan.routes.slice(1)] },
    } as ClientPlanRun;
    const html = view(planFinished(planStarted(base), plan));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("no stray undefined, NaN or [object Object], and unique ids, in any state", () => {
    for (const s of [done, planStarted(base), planFailed(planStarted(base), "x")]) {
      for (const tab of ["plan", "map", "whatif"] as Tab[]) {
        const html = view(s, tab, tab === "map" ? { maxMonths: 48 } : {});
        expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
        const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
  it("never nests a button in a button", () => {
    expect(view(done)).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });
  it("withLimit is unused here but a stale plan stays out of the way of the other tabs", () => {
    expect(view(done, "compare", { ...withLimit(base, 24) })).not.toContain("plan-step");
  });
});

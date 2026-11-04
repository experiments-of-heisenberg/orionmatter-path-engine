// @vitest-environment jsdom
/**
 * The Plan tab in a simulated browser: the real components and hook, the real routes behind a fetch stub, a scripted
 * model. Covers the live trace, the verdict, the map markers, staleness, double clicks, failure and leaving mid-run.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as planRoute } from "../src/app/api/plan/route";
import { PathApp } from "../src/components/PathApp";
import { createMockClient, type MockStep } from "../src/lib/model";
import { installServices, resetServices } from "./helpers/api";
import { compose, criticClean, overclaim, skipGather } from "./helpers/plan";

interface Call {
  path: string;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
let calls: Call[];
/** Holds the plan request until released, so the running state can be looked at. */
let planGate: Promise<void> | undefined;

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ path, body, signal: init.signal ?? undefined });
    if (path === "/api/plan" && planGate) await planGate;
    const handler = path === "/api/plan" ? planRoute : exploreRoute;
    return handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });
}
function install(steps: MockStep[] = [skipGather, compose, criticClean]): void {
  installServices(createMockClient(steps), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
}
const planCalls = () => calls.filter((c) => c.path === "/api/plan");
const markersIn = (container: HTMLElement) => container.querySelectorAll(".plan-step").length;

async function openPlan() {
  const view = render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
  await screen.findByRole("button", { name: "Build my plan" });
  return view;
}

beforeEach(() => {
  calls = [];
  planGate = undefined;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

describe("building a plan", () => {
  it("streams the trace, ends on the approved plan with its steps, and sends the current limits", async () => {
    install();
    await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    expect(planCalls()).toHaveLength(1);
    expect(planCalls()[0]?.body).toMatchObject({
      profile: { roleFamily: "backend", level: "L5" },
      goal: { targetLevel: "L6" },
      constraints: { riskTolerance: "medium", addSkills: [] },
    });
    expect(screen.getByText("First check: approved, no objections remain")).toBeTruthy();
    expect(screen.getByText(/5 evidence lookups, 5 filled in by code/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build it again" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Steps on the Climb route" })).toBeTruthy();
  });

  it("while it runs: the button is disabled, a status says what is happening, and a second click does nothing", async () => {
    install();
    let release: (() => void) | undefined;
    planGate = new Promise((resolve) => {
      release = resolve;
    });
    await openPlan();
    const button = screen.getByRole("button", { name: "Build my plan" });
    await userEvent.click(button);
    await screen.findByRole("status");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Working\u2026" }).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Working\u2026" }));
    expect(planCalls()).toHaveLength(1);
    release?.();
    await screen.findByText("The Skeptic approved this plan on its first check.");
    expect(planCalls()).toHaveLength(1);
  });

  it("the steps appear on the Map tab, and go when the limits change (the plan is then stale)", async () => {
    install();
    const view = await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(markersIn(view.container)).toBe(4);
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    fireEvent.change(screen.getByLabelText("Time limit"), { target: { value: "48" } });
    await waitFor(() => expect(markersIn(view.container)).toBe(0));
    await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByText(/This plan was made for earlier limits/)).toBeTruthy();
    // Resetting the limits makes the plan current again, and its steps come back
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(markersIn(view.container)).toBe(4));
  });

  it("another route's button shows that route's steps", async () => {
    install();
    await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(screen.getByRole("list", { name: "Steps on the Jump route" })).toBeTruthy();
  });

  it("an unresolved plan says so and puts nothing on the map", async () => {
    install([skipGather, overclaim, overclaim, overclaim]);
    const view = await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText(/did not approve this plan/);
    expect(screen.queryByText(/approved this plan/)).toBeNull();
    expect(screen.getAllByText("Promised or guaranteed an outcome").length).toBeGreaterThanOrEqual(2); // once per check
    expect(screen.getByText(/Check after revision 2: \d+ objection/)).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(markersIn(view.container)).toBe(0);
  });

  it("when the model fails the screen shows an alert, keeps the trace, and Try again works", async () => {
    install([skipGather]); // composing then finds the scripted model exhausted
    await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.length).toBeGreaterThan(5);
    expect(screen.getByText("Agent trace")).toBeTruthy();
    install([skipGather, compose, criticClean]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaving the screen mid-run aborts the request and raises no React warning", async () => {
    install();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let release: (() => void) | undefined;
    planGate = new Promise((resolve) => {
      release = resolve;
    });
    const view = await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await waitFor(() => expect(planCalls()).toHaveLength(1));
    view.unmount();
    expect(planCalls()[0]?.signal?.aborted).toBe(true);
    release?.();
    await new Promise((r) => setTimeout(r, 60));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("a plan keeps its trace through a switch of tab", async () => {
    install();
    await openPlan();
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(screen.getByRole("tab", { name: "Compare" }));
    await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByText("First check: approved, no objections remain")).toBeTruthy();
  });
});

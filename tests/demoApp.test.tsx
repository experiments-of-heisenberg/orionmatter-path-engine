// @vitest-environment jsdom
/**
 * The demo journey in a simulated browser, on recorded answers only: no network, no key, no scripted model. This is what
 * a visitor to the demo build does, so if it passes the demo works.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { GET as healthRoute } from "../src/app/api/health/route";
import { POST as intakeRoute } from "../src/app/api/intake/route";
import { POST as planRoute } from "../src/app/api/plan/route";
import { POST as privacyRoute } from "../src/app/api/privacy/route";
import { POST as whatifRoute } from "../src/app/api/whatif/route";
import { PathApp } from "../src/components/PathApp";
import { parseEnv } from "../src/lib/env";
import { FileFixtureStore, createModelClient } from "../src/lib/model";
import { WHATIF_EXAMPLES } from "../src/ui/demo";
import { installServices, resetServices } from "./helpers/api";

const routes: Record<string, (request: Request) => Response | Promise<Response>> = {
  "/api/explore": exploreRoute,
  "/api/intake": intakeRoute,
  "/api/plan": planRoute,
  "/api/privacy": privacyRoute,
  "/api/whatif": whatifRoute,
};

/** Extra time the explore route takes to answer, to make a slow network happen on purpose. */
let exploreDelayMs = 0;

beforeEach(() => {
  exploreDelayMs = 0;
  const env = parseEnv({ USE_FIXTURES: "true" });
  installServices(
    createModelClient(env, { fixtureMode: "replay", fixtures: new FileFixtureStore("src/fixtures") }),
    {
      USE_FIXTURES: "true",
      RATE_LIMIT_PER_MINUTE: "1000",
      MAX_CONCURRENT_RUNS: "20",
    },
  );
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/health") return Promise.resolve(healthRoute());
    const handler = routes[path];
    if (!handler) return Promise.resolve(new Response("not found", { status: 404 }));
    const answer = async (): Promise<Response> => {
      if (path === "/api/explore" && exploreDelayMs > 0)
        await new Promise((r) => setTimeout(r, exploreDelayMs));
      return handler(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: init?.body as string,
        }),
      );
    };
    return answer();
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

async function open() {
  const view = render(<PathApp />);
  await screen.findByText(/Climb:/);
  return view;
}

describe("the demo build", () => {
  it("says it is a replay", async () => {
    await open();
    await screen.findByText("Demo build: replaying recorded Muse Spark answers");
  });

  it("Your story: the example story reads, confirms, and lands on the map for that person", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
    await userEvent.click(screen.getByRole("button", { name: "Use an example story" }));
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("Everything the routes need was found. Please check each field below.");
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true"),
    );
    await screen.findByText(/Climb:|Jump:|Pivot:/);
    expect(screen.queryByText(/sample engineer/i)).toBeNull();
  });

  it.each(WHATIF_EXAMPLES.map((e) => [e]))(
    "What if: the example %s is understood, applied and explained",
    async (example) => {
      await open();
      await userEvent.click(screen.getByRole("tab", { name: "What if" }));
      await userEvent.click(await screen.findByRole("button", { name: example }));
      await screen.findByLabelText("Changes applied");
      expect(screen.queryByRole("alert")).toBeNull();
      await screen.findByText(/Phrased by Muse Spark/);
    },
  );

  it("Plan: after an example, the plan builds from the recording, is approved, and puts its steps on the map", async () => {
    const view = await open();
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await userEvent.click(await screen.findByRole("button", { name: WHATIF_EXAMPLES[2] }));
    await screen.findByLabelText("Changes applied");
    await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText(/The Skeptic approved this plan/, undefined, { timeout: 5000 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText(/Filled in by code|Chosen by Muse Spark/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    // Within 24 months only the jump route has anyone who finished, and a route nobody finished gets no markers.
    expect(view.container.querySelectorAll(".plan-step")).toHaveLength(0);
    await userEvent.click(screen.getAllByRole("button", { name: /^Jump route\./ })[0] as HTMLElement);
    expect(view.container.querySelectorAll(".plan-step").length).toBeGreaterThan(0);
  });

  it("Plan: steps wait for a map that is slow to redraw, instead of appearing on the old numbers and vanishing", async () => {
    // A plan can come back before the map has the numbers for new limits. This once failed on a slow CI runner: for a
    // moment the climb route (nobody finished it within 24 months) showed the steps of a plan made for those limits.
    const view = await open();
    exploreDelayMs = 2000;
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await userEvent.click(await screen.findByRole("button", { name: WHATIF_EXAMPLES[2] }));
    await screen.findByLabelText("Changes applied");
    await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText(/The Skeptic approved this plan/, undefined, { timeout: 5000 });
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(view.container.querySelectorAll(".plan-step")).toHaveLength(0);
    await userEvent.click(screen.getAllByRole("button", { name: /^Jump route\./ })[0] as HTMLElement);
    expect(view.container.querySelectorAll(".plan-step")).toHaveLength(0);
    // When the map has caught up, the steps appear on the route that has people who finished.
    await waitFor(() => expect(view.container.querySelectorAll(".plan-step").length).toBeGreaterThan(0), {
      timeout: 6000,
    });
  }, 15_000);

  it("Plan: the starting limits build from the recording too", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText(/The Skeptic approved this plan/, undefined, { timeout: 5000 });
  });

  it("Privacy: the example text is checked by Muse Spark and what it finds is shown with its quote", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use an example" }));
    await userEvent.click(screen.getByRole("button", { name: "Check with Muse Spark" }));
    await screen.findByText("High risk");
    expect(screen.getByText("Acme Robotics")).toBeTruthy();
    expect(screen.getByText(/Muse Spark read your text/)).toBeTruthy();
  });

  it("Share: the card is made for the sample person", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Share" }));
    await screen.findByRole("img", { name: /Trail card\. My route to Staff Engineer/ });
  });

  it("an unrecorded sentence is refused as demo-only, in words, and the box works again", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await userEvent.type(
      await screen.findByLabelText("What would you like to change?"),
      "what about moving to Mars",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("replays recorded Muse Spark answers");
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask" }).disabled).toBe(false),
    );
  });
});

// @vitest-environment jsdom
/**
 * No code reaches the screen. Levels (L5, EM1) and pay bands (B4) are how the data and the agents talk; a person is shown
 * job titles and money. This walks the whole demo journey on recorded Muse Spark answers (the answers themselves are full of
 * the codes) and fails if one appears in anything the page shows, on any tab, after any step.
 */
import { cleanup, render, screen } from "@testing-library/react";
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
import { humanize } from "../src/ui/display";
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

/** A level or pay-band code as a word of its own. Evidence ids are lower case hex and never match. */
const CODE = /\b(?:B[1-5]|L[3-7]|EM[12])\b/;

/** Everything on the page that a person reads: the text, plus the names assistive technology reads. */
function shown(container: HTMLElement): string {
  const names = [...container.querySelectorAll("[aria-label],[title]")].map(
    (e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`,
  );
  return `${container.textContent ?? ""} ${names.join(" ")}`;
}
function expectNoCode(container: HTMLElement, where: string): void {
  const text = shown(container);
  const hit = CODE.exec(text);
  if (hit)
    throw new Error(
      `${where}: found "${hit[0]}" in "...${text.slice(Math.max(0, hit.index - 60), hit.index + 40)}..."`,
    );
}

const TABS = ["Map", "What if", "Plan", "Compare", "Privacy", "Share", "Why", "Your story"];

describe("no level or pay-band code on any screen", () => {
  it("every tab of the opening view", async () => {
    const view = await open();
    for (const tab of TABS) {
      await userEvent.click(screen.getByRole("tab", { name: tab }));
      expectNoCode(view.container, `tab ${tab}`);
    }
  });

  it.each(WHATIF_EXAMPLES.map((e) => [e]))(
    "What if example %s: the answer, the chips, the cards, every tab",
    async (example) => {
      const view = await open();
      await userEvent.click(screen.getByRole("tab", { name: "What if" }));
      expectNoCode(view.container, "the examples");
      await userEvent.click(await screen.findByRole("button", { name: humanize(example, "IN-south") }));
      await screen.findByLabelText("Changes applied");
      await screen.findByText(/Phrased by Muse Spark/);
      for (const tab of ["What if", "Map", "Compare", "Why", "Share"]) {
        await userEvent.click(screen.getByRole("tab", { name: tab }));
        expectNoCode(view.container, `after "${example}", tab ${tab}`);
      }
    },
  );

  it("a pay minimum reads as a floor in the applied chip and in the explanation, never as a range", async () => {
    const view = await open();
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await userEvent.click(
      await screen.findByRole("button", { name: humanize(WHATIF_EXAMPLES[1], "IN-south") }),
    );
    const applied = await screen.findByLabelText("Changes applied");
    expect(applied.textContent).toContain("Minimum yearly pay");
    expect(applied.textContent).toContain("\u20b970L+");
    expect(applied.textContent).not.toContain("crore");
    await screen.findByText(/Phrased by Muse Spark/);
    expectNoCode(view.container, "after the pay minimum");
  });

  it("the plan, its steps and its trace", async () => {
    const view = await open();
    await userEvent.click(screen.getByRole("tab", { name: "Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText(/The Skeptic approved this plan/, undefined, { timeout: 5000 });
    expectNoCode(view.container, "the plan");
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expectNoCode(view.container, "the map with steps");
  });

  it("the privacy ladder, the text check and the share card", async () => {
    const view = await open();
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    expectNoCode(view.container, "the privacy ladder");
    await userEvent.click(screen.getByRole("button", { name: "Use an example" }));
    await userEvent.click(screen.getByRole("button", { name: "Check with Muse Spark" }));
    await screen.findByText("High risk", undefined, { timeout: 5000 });
    expectNoCode(view.container, "the text check");
    await userEvent.click(screen.getByRole("tab", { name: "Share" }));
    expectNoCode(view.container, "the share card");
  });

  it("the intake form reads the example story, with titles in its choices", async () => {
    const view = await open();
    await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
    await userEvent.click(screen.getByRole("button", { name: "Use an example story" }));
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("Everything the routes need was found. Please check each field below.");
    // the form's own fields: titles, not codes (the person's typed story is theirs and is left as written)
    const story = view.container.querySelector("textarea");
    const copy = view.container.cloneNode(true) as HTMLElement;
    // the typed story and the quotes taken from it ("From your words: ...") are the person's own words, left as written
    copy.querySelectorAll("textarea, .field__source").forEach((t) => t.remove());
    expectNoCode(copy, "the intake form");
    expect(story).not.toBeNull();
  });
});

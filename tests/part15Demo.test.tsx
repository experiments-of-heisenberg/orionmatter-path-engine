// @vitest-environment jsdom
/** The one-click examples, the replay banner, and what a visitor sees when a request was not recorded. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as privacyRoute } from "../src/app/api/privacy/route";
import { POST as whatifRoute } from "../src/app/api/whatif/route";
import { EXAMPLES } from "../src/components/Chat";
import { PathApp } from "../src/components/PathApp";
import { parseEnv } from "../src/lib/env";
import { MemoryFixtureStore, createMockClient, createModelClient } from "../src/lib/model";
import { DEMO_BIO, DEMO_STORY, WHATIF_EXAMPLES, exampleMessage } from "../src/ui/demo";
import { MAX_INTAKE } from "../src/ui/intake";
import { MAX_STORY } from "../src/ui/privacy";
import { installServices, resetServices } from "./helpers/api";

let health: (() => Response | Promise<Response>) | undefined;

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/health") {
      if (!health) throw new TypeError("down");
      return health();
    }
    const handler =
      path === "/api/whatif" ? whatifRoute : path === "/api/privacy" ? privacyRoute : exploreRoute;
    return handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: init.body as string,
      }),
    );
  });
}

beforeEach(() => {
  health = undefined;
  installServices(createMockClient([]), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

describe("the example texts", () => {
  it("fit the limits the server enforces, and say what the product needs them to say", () => {
    expect(DEMO_STORY.length).toBeLessThan(MAX_INTAKE);
    expect(DEMO_BIO.length).toBeLessThan(MAX_STORY);
    for (const word of ["backend", "L5", "7 years", "IN-south", "Go", "Kubernetes", "L6", "Staff Engineer"])
      expect(DEMO_STORY).toContain(word);
    for (const word of ["Acme Robotics", "Orion arm project", "jo@example.com", "4200000 rupees"])
      expect(DEMO_BIO).toContain(word);
  });
  it("the what-if examples are the ones Chat shows, and an example is sent with a plain apostrophe", () => {
    expect(EXAMPLES).toBe(WHATIF_EXAMPLES);
    expect(WHATIF_EXAMPLES).toHaveLength(4);
    expect(exampleMessage("What if I won\u2019t relocate?")).toBe("What if I won't relocate?");
    expect(exampleMessage("no apostrophe")).toBe("no apostrophe");
  });
});

describe("the example buttons", () => {
  it("fill the story box and the privacy box, without sending anything", async () => {
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
    await userEvent.click(screen.getByRole("button", { name: "Use an example story" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your career in a few lines").value).toBe(DEMO_STORY);
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use an example" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your text").value).toBe(DEMO_BIO);
  });
});

describe("the replay banner", () => {
  it("is shown when the server says it replays recorded answers", async () => {
    health = () => Response.json({ ok: true, mode: "fixtures" });
    render(<PathApp />);
    await screen.findByText("Demo build: replaying recorded Muse Spark answers");
  });
  it("is not shown for a live server, a failed question, or an answer it does not understand", async () => {
    for (const make of [
      () => Response.json({ ok: true, mode: "live" }),
      () => new Response("{}", { status: 500 }),
      () => Response.json({ mode: "other" }),
      () => new Response("not json"),
    ]) {
      health = make;
      const view = render(<PathApp />);
      await screen.findByText(/Climb:/);
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText(/Demo build/)).toBeNull();
      view.unmount();
    }
    health = undefined; // the question itself fails
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    expect(screen.queryByText(/Demo build/)).toBeNull();
  });
});

describe("a request that was not recorded", () => {
  it("is said plainly in the chat, with a way forward, not as a broken server", async () => {
    const env = parseEnv({ USE_FIXTURES: "true" });
    installServices(createModelClient(env, { fixtureMode: "replay", fixtures: new MemoryFixtureStore() }), {
      USE_FIXTURES: "true",
      RATE_LIMIT_PER_MINUTE: "1000",
    });
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    fireEvent.change(await screen.findByLabelText("What would you like to change?"), {
      target: { value: "anything unrecorded" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("replays recorded Muse Spark answers");
    expect(alert.textContent).toContain("example buttons");
    expect(alert.textContent).not.toContain("not configured");
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask" }).disabled).toBe(false),
    );
  });
});

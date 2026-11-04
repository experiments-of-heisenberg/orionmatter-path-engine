// @vitest-environment jsdom
/** The Privacy tab in a simulated browser against the real routes and a scripted model. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as privacyRoute } from "../src/app/api/privacy/route";
import { PathApp } from "../src/components/PathApp";
import { createMockClient, type MockStep } from "../src/lib/model";
import { installServices, resetServices } from "./helpers/api";
import { STORY, modelFindings } from "./helpers/privacy";

interface Call {
  path: string;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
let calls: Call[];
let gate: ((index: number) => Promise<void> | undefined) | undefined;

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ path, body, signal: init.signal ?? undefined });
    if (path === "/api/privacy") await gate?.(calls.filter((c) => c.path === path).length - 1);
    const handler = path === "/api/privacy" ? privacyRoute : exploreRoute;
    return handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });
}
function install(steps: MockStep[] = []): void {
  installServices(createMockClient(steps), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
}
const privacyCalls = () => calls.filter((c) => c.path === "/api/privacy");

async function openPrivacy() {
  const view = render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
  await screen.findByRole("heading", { name: "What sharing reveals" });
  return view;
}

beforeEach(() => {
  calls = [];
  gate = undefined;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

describe("the ladder", () => {
  it("loads by itself with no text and no model, and draws four steps", async () => {
    install();
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    expect(privacyCalls()[0]?.body).toMatchObject({ k: 10 });
    expect("text" in (privacyCalls()[0]?.body ?? {})).toBe(false);
    expect(screen.getByText("93 engineers")).toBeTruthy();
    expect(screen.getByText("Sharing all of it still leaves a crowd of at least 10.")).toBeTruthy();
  });

  it("changing the crowd size or the company type asks again and redraws", async () => {
    install();
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    await userEvent.selectOptions(screen.getByLabelText("A company type you might mention"), "robotics");
    await screen.findByText("4 engineers");
    expect(privacyCalls().at(-1)?.body).toMatchObject({ companyType: "robotics", k: 10 });
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "5");
    await waitFor(() => expect(privacyCalls().at(-1)?.body).toMatchObject({ k: 5 }));
    await waitFor(() => expect(screen.getAllByText("Crowd of 5+").length).toBeGreaterThanOrEqual(4));
    await userEvent.selectOptions(screen.getByLabelText("A company type you might mention"), "");
    await waitFor(() => expect("companyType" in (privacyCalls().at(-1)?.body ?? {})).toBe(false));
  });

  it("a failure shows an alert and Try again recovers", async () => {
    install();
    let first = true;
    gate = () => {
      if (!first) return undefined;
      first = false;
      return Promise.reject(new TypeError("down"));
    };
    await openPrivacy();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach the server");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("How the crowd shrinks as you share more");
  });

  it("a slow older answer cannot replace a newer one", async () => {
    install();
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    let release: (() => void) | undefined;
    gate = (index) =>
      index === 1
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined;
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "20");
    await waitFor(() => expect(privacyCalls()).toHaveLength(2));
    gate = undefined;
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "50");
    await waitFor(() => expect(screen.getAllByText(/Fewer than 50|Crowd of 50\+/).length).toBeGreaterThan(0));
    expect(privacyCalls()[1]?.signal?.aborted).toBe(true);
    release?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Crowd of 20+")).toBeNull();
  });
});

describe("the text check", () => {
  it("with Muse Spark: sends the text and the choice, and shows findings with the invented one dropped", async () => {
    install([modelFindings]);
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: STORY } });
    await userEvent.click(screen.getByRole("button", { name: "Check with Muse Spark" }));
    await screen.findByText("High risk");
    expect(privacyCalls().at(-1)?.body).toMatchObject({ text: STORY, useModel: true });
    expect(screen.getByText("Acme Robotics")).toBeTruthy();
    expect(screen.queryByText("Nobel prize")).toBeNull();
    expect(screen.getByText(/I worked at \[a company\] on the \[a project\]/)).toBeTruthy();
  });

  it("with code only: sends useModel false and says the model was not used", async () => {
    install();
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: STORY } });
    await userEvent.click(screen.getByRole("button", { name: "Check with code only" }));
    await screen.findByText(/The model was not used/);
    expect(privacyCalls().at(-1)?.body).toMatchObject({ useModel: false });
  });

  it("empty text is refused on screen without calling the server", async () => {
    install();
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    const before = privacyCalls().length;
    await userEvent.click(screen.getByRole("button", { name: "Check with code only" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Paste or type the text");
    expect(privacyCalls()).toHaveLength(before);
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: "x" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("the draft survives a change of tab", async () => {
    install();
    await openPrivacy();
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: "half a bio" } });
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your text").value).toBe("half a bio");
  });

  it("changing the crowd size after a check marks that result as made for other settings", async () => {
    install();
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: STORY } });
    await userEvent.click(screen.getByRole("button", { name: "Check with code only" }));
    await screen.findByText(/The model was not used/);
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "20");
    await screen.findByText(/Run it again to match/);
  });

  it("a second click while checking does nothing, and a failed check shows an alert", async () => {
    install();
    let release: (() => void) | undefined;
    await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    gate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: STORY } });
    await userEvent.click(screen.getByRole("button", { name: "Check with code only" }));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check with code only" }).disabled).toBe(
        true,
      ),
    );
    const during = privacyCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "Check with code only" }));
    expect(privacyCalls()).toHaveLength(during);
    release?.();
    await screen.findByText(/The model was not used/);
  });

  it("leaving the screen aborts a check in progress without a React warning", async () => {
    install();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = await openPrivacy();
    await screen.findByLabelText("How the crowd shrinks as you share more");
    let release: (() => void) | undefined;
    gate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: STORY } });
    await userEvent.click(screen.getByRole("button", { name: "Check with code only" }));
    await waitFor(() => expect(privacyCalls().length).toBeGreaterThanOrEqual(2));
    view.unmount();
    expect(privacyCalls().at(-1)?.signal?.aborted).toBe(true);
    release?.();
    await new Promise((r) => setTimeout(r, 60));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

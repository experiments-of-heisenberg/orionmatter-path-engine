// @vitest-environment jsdom
/**
 * Cross-tab behaviour: state kept across tabs, the session rebuild on confirm, stale plans,
 * tab order and arrow keys, and three requests in flight at once. Real components and hooks,
 * real routes behind a fetch stub, a scripted model.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as intakeRoute } from "../src/app/api/intake/route";
import { POST as planRoute } from "../src/app/api/plan/route";
import { POST as privacyRoute } from "../src/app/api/privacy/route";
import { POST as whatifRoute } from "../src/app/api/whatif/route";
import { EXAMPLES } from "../src/components/Chat";
import { PathApp, TABS } from "../src/components/PathApp";
import { createMockClient, type MockStep } from "../src/lib/model";
import { ARCHETYPE_LABEL, type Archetype } from "../src/ui/format";
import type { Person } from "../src/ui/sample";
import { installServices, resetServices } from "./helpers/api";
import { STORY_TEXT, fullReading } from "./helpers/intake";
import { compose, criticClean, skipGather } from "./helpers/plan";
import { exploreFor } from "./helpers/ui";
import { says } from "./helpers/whatif";

interface Call {
  path: string;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
let calls: Call[];
/** Holds plan requests until released, so the running state overlaps other requests. */
let planGate: Promise<void> | undefined;
/** Holds privacy requests from the second one on, until released. */
let privacyGate: Promise<void> | undefined;

const handlers: Record<string, (request: Request) => Promise<Response>> = {
  "/api/explore": exploreRoute,
  "/api/plan": planRoute,
  "/api/privacy": privacyRoute,
  "/api/intake": intakeRoute,
  "/api/whatif": whatifRoute,
};

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    if (path === "/api/whatif") body["narrate"] = false; // the narration model is covered elsewhere
    const call: Call = { path, body, signal: init.signal ?? undefined };
    calls.push(call);
    if (path === "/api/plan" && planGate) await planGate;
    if (path === "/api/privacy" && calls.filter((c) => c.path === path).length > 1 && privacyGate)
      await privacyGate;
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected call to ${path}`);
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
const planCalls = () => calls.filter((c) => c.path === "/api/plan");
const privacyCalls = () => calls.filter((c) => c.path === "/api/privacy");
const tab = (name: string) => screen.getByRole("tab", { name });
const select = (name: string) => screen.getByLabelText<HTMLSelectElement>(name, { exact: false });

async function open() {
  const view = render(<PathApp />);
  await screen.findByText(/Climb:/);
  return view;
}

/** The person the confirm tests type by hand: platform L4 in SEA aiming for Senior Engineer. */
const CONFIRMED: Person = {
  profile: {
    roleFamily: "platform",
    level: "L4",
    yearsExperience: 3.5,
    stack: [],
    region: "SEA",
    milestones: [],
  },
  goal: { targetLevel: "L5", label: "Senior Engineer" },
  constraints: { riskTolerance: "medium", addSkills: [] },
};

async function fillFormByHand(): Promise<void> {
  await userEvent.click(tab("Your story"));
  await screen.findByRole("heading", { name: "Tell us about your career" });
  await userEvent.selectOptions(select("Role"), "platform");
  await userEvent.selectOptions(select("Current level"), "L4");
  fireEvent.change(screen.getByLabelText(/Years of experience/), { target: { value: "3.5" } });
  await userEvent.selectOptions(select("Region"), "SEA");
  await userEvent.selectOptions(select("Goal level"), "L5");
}

async function confirm(): Promise<void> {
  await fillFormByHand();
  await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
  await screen.findByText(/Climb:|Jump:|Pivot:/);
}

beforeEach(() => {
  calls = [];
  planGate = undefined;
  privacyGate = undefined;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

describe("state kept across tabs", () => {
  it("a built plan, the privacy draft, intake edits and scenarios survive a tour of every tab", async () => {
    install([skipGather, compose, criticClean]);
    await open();
    // Build the state: a plan, a scenario, a privacy draft, an intake edit.
    await userEvent.click(tab("What if"));
    await screen.findByRole("heading", { name: "Your limits" });
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario A.");
    await userEvent.click(tab("Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(tab("Privacy"));
    await screen.findByLabelText("How the crowd shrinks as you share more");
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: "half a bio" } });
    await userEvent.click(tab("Your story"));
    await userEvent.selectOptions(select("Role"), "platform");
    // Through every tab and back.
    for (const t of TABS) await userEvent.click(tab(t.label));
    // Each is intact.
    await userEvent.click(tab("Plan"));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    expect(screen.getByText("First check: approved, no objections remain")).toBeTruthy();
    await userEvent.click(tab("Privacy"));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your text").value).toBe("half a bio");
    await userEvent.click(tab("Your story"));
    expect(select("Role").value).toBe("platform");
    await userEvent.click(tab("What if"));
    expect(screen.getByText("Saved as Scenario A.")).toBeTruthy();
    expect(screen.getByDisplayValue("Scenario A")).toBeTruthy();
  });
});

describe("confirming a person rebuilds the session", () => {
  it("resets plan, privacy, scenarios, chat, selection and toggles; the intake form keeps what was typed", async () => {
    install([
      says({ changes: [{ field: "noRelocation", value: true, phrase: "won't relocate" }] }),
      skipGather,
      compose,
      criticClean,
    ]);
    const recommended = exploreFor({}, CONFIRMED).data.ranking.recommended ?? "climb";
    const other = (["climb", "jump", "pivot"] as Archetype[]).find((a) => a !== recommended) ?? "jump";
    await open();
    // A scenario, a chat turn, a plan, a privacy draft with a bigger crowd, another selection, a hidden route.
    await userEvent.click(tab("What if"));
    await screen.findByRole("heading", { name: "Your limits" });
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario A.");
    await userEvent.click(screen.getByRole("button", { name: EXAMPLES[0] }));
    await screen.findByLabelText("Changes applied");
    await userEvent.click(tab("Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(tab("Privacy"));
    await screen.findByLabelText("How the crowd shrinks as you share more");
    fireEvent.change(screen.getByLabelText("Your text"), { target: { value: "half a bio" } });
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "20");
    await userEvent.click(tab("Map"));
    await userEvent.click(screen.getByRole("button", { name: ARCHETYPE_LABEL[other] }));
    await userEvent.click(tab("Compare"));
    await screen.findByRole("heading", { name: "Compare the routes" });
    await userEvent.click(screen.getByRole("button", { name: "Climb" }));
    expect(screen.getByRole("button", { name: "Climb" }).getAttribute("aria-pressed")).toBe("false");

    await confirm();

    // Everything from the sample is fresh again.
    await userEvent.click(tab("Plan"));
    await screen.findByRole("button", { name: "Build my plan" });
    expect(screen.queryByText(/Skeptic approved/)).toBeNull();
    await userEvent.click(tab("Privacy"));
    await screen.findByLabelText("How the crowd shrinks as you share more");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your text").value).toBe("");
    expect(screen.getByLabelText<HTMLSelectElement>("Stay in a crowd of at least").value).toBe("10");
    expect(screen.getByLabelText<HTMLSelectElement>("A company type you might mention").value).toBe("");
    await userEvent.click(tab("What if"));
    await screen.findByRole("heading", { name: "Your limits" });
    expect(screen.getByText("Nothing saved yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: EXAMPLES[3] })).toBeTruthy();
    expect(screen.queryByLabelText("Changes applied")).toBeNull();
    await userEvent.click(tab("Map"));
    expect(screen.getByRole("button", { name: ARCHETYPE_LABEL[other] }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(
      screen.getByRole("button", { name: ARCHETYPE_LABEL[recommended] }).getAttribute("aria-pressed"),
    ).toBe("true");
    await userEvent.click(tab("Compare"));
    for (const name of ["Climb", "Jump", "Pivot"])
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    // The intake form itself is above the session, so it keeps what was typed. Stated, not reset.
    await userEvent.click(tab("Your story"));
    expect(select("Role").value).toBe("platform");
    expect(screen.getByLabelText<HTMLInputElement>(/Years of experience/).value).toBe("3.5");
  });

  it("requests the privacy ladder again for the confirmed person", async () => {
    install([]);
    await open();
    await confirm();
    await userEvent.click(tab("Privacy"));
    await screen.findByLabelText("How the crowd shrinks as you share more");
    expect(privacyCalls().length).toBeGreaterThanOrEqual(2);
    const last = privacyCalls().at(-1)?.body as { profile: Record<string, unknown> };
    expect(last.profile).toMatchObject({ roleFamily: "platform", level: "L4", region: "SEA" });
  });

  it("the Share tab for a confirmed person uses their role and region, not the sample's", async () => {
    install([]);
    await open();
    await confirm();
    await userEvent.click(tab("Share"));
    await screen.findByRole("img", { name: /Trail card/ });
    const what = screen.getByText(/On the card:/).closest("p")?.textContent ?? "";
    expect(what).toContain("Platform");
    // The goal and the region fall below the crowd for this person, so the region is named as
    // withheld rather than shown — still the confirmed person's region, not the sample's.
    const leftOff = screen.getByText(/Left off:/).closest("p")?.textContent ?? "";
    expect(leftOff).toContain("South-East Asia");
    expect(screen.queryByText("South India")).toBeNull();
    expect(screen.queryByText("Backend")).toBeNull();
  });
});

describe("a plan made for earlier limits", () => {
  it("changing a What-if limit clears the map markers and the Plan tab says so", async () => {
    install([skipGather, compose, criticClean]);
    const view = await open();
    await userEvent.click(tab("Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(tab("What if"));
    fireEvent.change(screen.getByLabelText("Time limit"), { target: { value: "48" } });
    await userEvent.click(tab("Share"));
    await screen.findByRole("heading", { name: "Share your trail" });
    await userEvent.click(tab("Plan"));
    await screen.findByText(/This plan was made for earlier limits/);
    await userEvent.click(tab("Map"));
    await waitFor(() => expect(view.container.querySelectorAll(".plan-step").length).toBe(0));
  });
});

describe("tab order and arrow keys", () => {
  it("renders TABS in order and arrows reach Your story, Privacy and Share", async () => {
    install([]);
    await open();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(TABS.map((t) => t.label));
    tab("Map").focus();
    for (const name of ["What if", "Plan", "Compare", "Privacy"]) {
      fireEvent.keyDown(document.activeElement ?? tab("Map"), { key: "ArrowRight" });
      expect(tab(name).getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tab(name));
    }
    fireEvent.keyDown(tab("Privacy"), { key: "ArrowRight" });
    expect(tab("Share").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Share"));
    for (const name of ["Privacy", "Compare", "Plan", "What if", "Map", "Your story"]) {
      fireEvent.keyDown(document.activeElement ?? tab("Share"), { key: "ArrowLeft" });
      expect(tab(name).getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tab(name));
    }
  });
});

describe("three requests at once", () => {
  it("a running plan, a reloading ladder and an intake read finish independently with no React warning", async () => {
    install([fullReading, skipGather, compose, criticClean]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let releasePlan: (() => void) | undefined;
    let releasePrivacy: (() => void) | undefined;
    planGate = new Promise((resolve) => {
      releasePlan = resolve;
    });
    privacyGate = new Promise((resolve) => {
      releasePrivacy = resolve;
    });
    await open();
    await userEvent.click(tab("Privacy"));
    await screen.findByLabelText("How the crowd shrinks as you share more");
    await userEvent.click(tab("Plan"));
    await userEvent.click(screen.getByRole("button", { name: "Build my plan" }));
    await waitFor(() => expect(planCalls()).toHaveLength(1));
    await userEvent.click(tab("Privacy"));
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "20");
    await waitFor(() => expect(privacyCalls()).toHaveLength(2));
    await userEvent.click(tab("Your story"));
    fireEvent.change(screen.getByLabelText("Your career in a few lines"), { target: { value: STORY_TEXT } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    releasePlan?.();
    releasePrivacy?.();
    await userEvent.click(tab("Plan"));
    await screen.findByText("The Skeptic approved this plan on its first check.");
    await userEvent.click(tab("Privacy"));
    await screen.findByText("Fewer than 20");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

// @vitest-environment jsdom
/**
 * The What if screen's sharp edges, in a simulated browser: the real components and hook, the real
 * route handlers behind a fetch stub, a scripted model. Covers chat-while-working, a chat answer that
 * lands after the slider moved, failure after a good load, rapid saves, radar toggles across tab
 * switches, tab arrow keys, conflicts on both tabs, and unmounting mid-request.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as whatifRoute } from "../src/app/api/whatif/route";
import { PathApp } from "../src/components/PathApp";
import { createMockClient, type MockStep } from "../src/lib/model";
import { installServices, resetServices } from "./helpers/api";
import { says } from "./helpers/whatif";

interface Call {
  path: string;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
let calls: Call[];
/** Optional hooks to hold back or fail a call, by its order among calls to that path. */
let exploreGate: ((index: number, call: Call) => Promise<Response | undefined> | undefined) | undefined;
let whatifGate: ((index: number, call: Call) => Promise<Response | undefined> | undefined) | undefined;

const handlers: Record<string, (request: Request) => Promise<Response>> = {
  "/api/explore": exploreRoute,
  "/api/whatif": whatifRoute,
};

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    if (path === "/api/whatif") body["narrate"] = false; // the narration model is covered elsewhere
    const call: Call = { path, body, signal: init.signal ?? undefined };
    calls.push(call);
    const gate = path === "/api/explore" ? exploreGate : path === "/api/whatif" ? whatifGate : undefined;
    if (gate) {
      const held = gate(calls.filter((c) => c.path === path).length - 1, call);
      if (held) {
        const response = await held;
        if (response) return response;
      }
    }
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
const exploreCalls = () => calls.filter((c) => c.path === "/api/explore");
const whatifCalls = () => calls.filter((c) => c.path === "/api/whatif");
const slider = () => screen.getByLabelText<HTMLInputElement>("Time limit");
const chatBox = () =>
  screen.getByLabelText<HTMLTextAreaElement>(/What would you like to change|Type your answer/);

async function open(): Promise<void> {
  render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "What if" }));
  await screen.findByRole("heading", { name: "Your limits" });
}

beforeEach(() => {
  calls = [];
  exploreGate = undefined;
  whatifGate = undefined;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

describe("a second message while the first is still working", () => {
  it("the Ask button is disabled and Enter sends nothing", async () => {
    install([says({ changes: [{ field: "maxMonths", value: 24, phrase: "within 2 years" }] })]);
    await open();
    let release: (() => void) | undefined;
    whatifGate = () =>
      new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    await userEvent.type(chatBox(), "within 2 years");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(/Understanding what you asked/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Working\u2026" }).disabled).toBe(true);
    await userEvent.type(chatBox(), "second message{Enter}");
    expect(whatifCalls()).toHaveLength(1);
    expect(chatBox().value).toBe("second message"); // Enter did nothing, so the draft is untouched
    release?.();
    await screen.findByLabelText("Changes applied");
    expect(whatifCalls()).toHaveLength(1);
  });
});

describe("a chat answer that lands after the slider moved (review fix)", () => {
  async function askThenMoveSlider(): Promise<void> {
    install([says({ changes: [{ field: "maxMonths", value: 24, phrase: "within 2 years" }] })]);
    await open();
    let release: (() => void) | undefined;
    whatifGate = () =>
      new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    await userEvent.type(chatBox(), "within 2 years");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(whatifCalls()).toHaveLength(1));
    fireEvent.change(slider(), { target: { value: "36" } });
    await waitFor(() => expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ maxMonths: 36 }));
    release?.();
    await screen.findByLabelText("Changes understood");
  }

  it("the newer slider move stays, and the answer waits behind a button", async () => {
    await askThenMoveSlider();
    expect(slider().value).toBe("36");
    expect(screen.getByText("Understood, not applied")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Held back because you changed your limits" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 250));
    expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ maxMonths: 36 });
  });

  it("'Apply these changes instead' applies it, redraws, and removes the notice", async () => {
    await askThenMoveSlider();
    await userEvent.click(screen.getByRole("button", { name: "Apply these changes instead" }));
    await waitFor(() => expect(slider().value).toBe("24"));
    await waitFor(() => expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ maxMonths: 24 }));
    expect(screen.queryByRole("group", { name: "Held back because you changed your limits" })).toBeNull();
    expect(screen.getByLabelText("Changes applied")).toBeTruthy();
  });

  it("an answer that changes nothing is not held, even if the slider moved", async () => {
    install([says({})]);
    await open();
    let release: (() => void) | undefined;
    whatifGate = () =>
      new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    await userEvent.type(chatBox(), "thanks");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(whatifCalls()).toHaveLength(1));
    fireEvent.change(slider(), { target: { value: "36" } });
    release?.();
    await screen.findByText(/Nothing in that could be turned into a change/);
    expect(screen.queryByText("Understood, not applied")).toBeNull();
    expect(slider().value).toBe("36");
  });
});

describe("what survives a change of tab (review fix)", () => {
  it("a half-typed chat message is still there when the person comes back", async () => {
    install();
    await open();
    await userEvent.type(chatBox(), "what if I");
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    expect(chatBox().value).toBe("what if I");
  });

  it("sending clears the saved draft", async () => {
    install([says({})]);
    await open();
    await userEvent.type(chatBox(), "thanks{Enter}");
    await waitFor(() => expect(chatBox().value).toBe(""));
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    expect(chatBox().value).toBe("");
  });
});

describe("the starting point for 'what changed'", () => {
  it("the controls do not exist until the first answer has arrived, so the starting point is always the starting limits", async () => {
    install();
    exploreGate = () => new Promise(() => undefined); // the first answer never comes
    render(<PathApp />);
    await waitFor(() => expect(exploreCalls()).toHaveLength(1));
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    expect(screen.queryByLabelText("Time limit")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your limits" })).toBeNull();
  });
});

describe("an explore failure after a good load", () => {
  it("keeps the old map on screen with the error alert, and Try again recovers", async () => {
    install();
    await open();
    exploreGate = () => Promise.resolve(new Response("{}", { status: 502 }));
    fireEvent.change(slider(), { target: { value: "24" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("502");
    expect(screen.getByText(/Climb:/)).toBeTruthy(); // the old map is still drawn, not replaced
    exploreGate = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await screen.findByText("Start-here route is now Jump (it was Climb).");
  });
});

describe("rapid saves", () => {
  it("two rapid 'Save these limits' clicks on identical limits produce one scenario", async () => {
    install();
    await open();
    const save = screen.getByRole("button", { name: "Save these limits" });
    fireEvent.click(save);
    fireEvent.click(save);
    // The first click saves; the second is refused as a duplicate. Either way one scenario exists.
    await screen.findByText("These settings are already saved as Scenario A.");
    const table = screen.getByRole("table", { name: "Saved scenarios side by side" });
    expect(within(table).getAllByRole("row")).toHaveLength(2); // the header and one scenario
  });
});

describe("radar toggles across a tab switch", () => {
  it("a hidden route stays hidden after visiting What if and coming back", async () => {
    install();
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    await userEvent.click(screen.getByRole("tab", { name: "Compare" }));
    const climb = screen.getByRole("button", { name: "Climb" });
    expect(climb.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(climb);
    expect(climb.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await screen.findByRole("heading", { name: "Your limits" });
    await userEvent.click(screen.getByRole("tab", { name: "Compare" }));
    expect(screen.getByRole("button", { name: "Climb" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("tab arrow keys", () => {
  it("moves through all four tabs and wraps in both directions", async () => {
    install();
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    const tab = (name: string) => screen.getByRole("tab", { name });
    tab("Map").focus();
    fireEvent.keyDown(tab("Map"), { key: "ArrowRight" });
    expect(tab("What if").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("What if"));
    fireEvent.keyDown(tab("What if"), { key: "ArrowRight" });
    expect(tab("Compare").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Compare"), { key: "ArrowRight" });
    expect(tab("Why").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Why"), { key: "ArrowRight" });
    expect(tab("Map").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Map"));
    fireEvent.keyDown(tab("Map"), { key: "ArrowLeft" });
    expect(tab("Why").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Why"));
  });
});

describe("conflicts on both tabs", () => {
  it("a 12-month limit shows the same notice on the Map tab and the What if tab", async () => {
    install();
    await open();
    fireEvent.change(slider(), { target: { value: "12" } });
    const conflict = /None of the comparable engineers reached this goal within 12 months/;
    await screen.findByText(conflict);
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    await screen.findByText(conflict);
  });
});

describe("unmounting mid-request", () => {
  it("aborts the in-flight explore and logs no React warning", async () => {
    install();
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    try {
      await open();
      exploreGate = () => new Promise(() => undefined); // the next explore call never answers
      fireEvent.change(slider(), { target: { value: "24" } });
      await waitFor(() => expect(exploreCalls()).toHaveLength(2));
      cleanup(); // unmount
      await new Promise((r) => setTimeout(r, 100));
      expect(exploreCalls()[1]?.signal?.aborted).toBe(true);
      expect(errors.filter((line) => /warning/i.test(line))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

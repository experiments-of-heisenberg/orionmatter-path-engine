// @vitest-environment jsdom
/**
 * The interactive What if screen, end to end in a simulated browser: the real components and hook, the real
 * route handlers behind a fetch stub, a scripted model. Checks what the sliders, the chat, the scenarios and the
 * suggestions do, including the failure and stale-answer cases that a static render cannot show.
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
/** Optional hook to hold back or fail an explore call, by its order among explore calls. */
let gate: ((index: number, call: Call) => Promise<Response | undefined> | undefined) | undefined;

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
    if (path === "/api/explore") {
      const held = gate?.(calls.filter((c) => c.path === path).length - 1, call);
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
const slider = () => screen.getByLabelText<HTMLInputElement>("Time limit");

async function open(): Promise<void> {
  render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "What if" }));
  await screen.findByRole("heading", { name: "Your limits" });
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

describe("loading", () => {
  it("shows a busy skeleton, then the map, after one explore call with the starting limits", async () => {
    install();
    render(<PathApp />);
    expect(screen.getByLabelText("Loading your routes")).toBeTruthy();
    await screen.findByText(/Climb:/);
    expect(exploreCalls()).toHaveLength(1);
    expect(exploreCalls()[0]?.body["constraints"]).toEqual({ riskTolerance: "medium", addSkills: [] });
    expect(screen.queryByLabelText("Loading your routes")).toBeNull();
  });

  it("a failed first load shows an alert, and Try again loads it", async () => {
    install();
    let first = true;
    gate = () => {
      if (!first) return undefined;
      first = false;
      return Promise.resolve(new Response("{}", { status: 502 }));
    };
    render(<PathApp />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("502");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/Climb:/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the time slider", () => {
  it("moving it redraws from the instant route, says what changed, and never calls the model", async () => {
    install();
    await open();
    expect(slider().value).toBe("73");
    fireEvent.change(slider(), { target: { value: "24" } });
    expect(screen.getByText("24 months", { selector: "output" })).toBeTruthy(); // the label moves at once
    await screen.findByText("Start-here route is now Jump (it was Climb).");
    expect(screen.getAllByText("None within your limits").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.path === "/api/whatif")).toHaveLength(0);
    expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ maxMonths: 24 });
  });

  it("a burst of movements asks the server once, for the last position", async () => {
    install();
    await open();
    for (const v of ["40", "36", "30", "24"]) {
      fireEvent.change(slider(), { target: { value: v } });
      await new Promise((r) => setTimeout(r, 30)); // quicker than the pause, so each movement cancels the one before
    }
    await screen.findByText("Start-here route is now Jump (it was Climb).");
    expect(exploreCalls()).toHaveLength(2); // the first load and one more
    expect(exploreCalls()[1]?.body["constraints"]).toMatchObject({ maxMonths: 24 });
  });

  it("an answer that arrives after a newer request was made does not overwrite it", async () => {
    install();
    await open();
    let release: (() => void) | undefined;
    gate = (index) => {
      if (index !== 1) return undefined;
      // hold the second explore call (limit 36) until after the third (limit 24) has been drawn
      return new Promise((resolve) => {
        release = () => resolve(undefined);
      });
    };
    fireEvent.change(slider(), { target: { value: "36" } });
    await waitFor(() => expect(exploreCalls()).toHaveLength(2));
    fireEvent.change(slider(), { target: { value: "24" } });
    await screen.findByText("Start-here route is now Jump (it was Climb).");
    expect(exploreCalls()[1]?.signal?.aborted).toBe(true);
    release?.(); // the stale call now completes and would have drawn the 36-month map
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("24 months", { selector: "output" })).toBeTruthy();
    expect(screen.getByText("Start-here route is now Jump (it was Climb).")).toBeTruthy();
    // At 36 months the climb is reachable; at 24 it is not. The 24-month picture must still be the one on screen.
    expect(screen.getAllByText("None within your limits").length).toBeGreaterThanOrEqual(2);
  });

  it("dragging back to the last stop removes the limit again", async () => {
    install();
    await open();
    fireEvent.change(slider(), { target: { value: "24" } });
    await waitFor(() => expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ maxMonths: 24 }));
    fireEvent.change(slider(), { target: { value: "73" } });
    await waitFor(() =>
      expect("maxMonths" in (exploreCalls().at(-1)?.body["constraints"] as object)).toBe(false),
    );
    expect(screen.getByText("No limit", { selector: "output" })).toBeTruthy();
  });

  it("Reset puts every limit back and is disabled when nothing has changed", async () => {
    install();
    await open();
    const reset = screen.getByRole<HTMLButtonElement>("button", { name: "Reset" });
    expect(reset.disabled).toBe(true);
    fireEvent.change(slider(), { target: { value: "24" } });
    await waitFor(() => expect(reset.disabled).toBe(false));
    await userEvent.click(reset);
    expect(slider().value).toBe("73");
    await waitFor(() =>
      expect(screen.getByText("Nothing has moved enough to report yet. Try a limit.")).toBeTruthy(),
    );
  });
});

describe("the other controls", () => {
  it("a pay band and a switch change the request and the pressed state", async () => {
    install();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "\u20b970L+" }));
    await userEvent.click(screen.getByRole("switch", { name: /No relocation/ }));
    await waitFor(() =>
      expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({
        minCompBand: "B4",
        noRelocation: true,
      }),
    );
    expect(screen.getByRole("button", { name: "\u20b970L+" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("switch", { name: /No relocation/ }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Any" }));
    await waitFor(() =>
      expect("minCompBand" in (exploreCalls().at(-1)?.body["constraints"] as object)).toBe(false),
    );
  });

  it("skills: add by typing and Enter, see a chip, remove it, and the request follows", async () => {
    install();
    await open();
    await userEvent.type(screen.getByLabelText("Skills to ask about"), "Rust{Enter}");
    await screen.findByRole("button", { name: "Stop asking about rust" });
    await waitFor(() =>
      expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ addSkills: ["rust"] }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Stop asking about rust" }));
    await waitFor(() => expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ addSkills: [] }));
  });
});

describe("the chat", () => {
  it("a sentence is understood, applied, and the map and the controls follow", async () => {
    install([says({ changes: [{ field: "maxMonths", value: 24, phrase: "within 2 years" }] })]);
    await open();
    await userEvent.type(
      screen.getByLabelText("What would you like to change?"),
      "What if I want it within 2 years?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByLabelText("Changes applied");
    expect(screen.getByText("within 2 years")).toBeTruthy();
    await waitFor(() => expect(slider().value).toBe("24"));
    await screen.findByText("Start-here route is now Jump (it was Climb).");
    const body = calls.find((c) => c.path === "/api/whatif")?.body;
    expect(body).toMatchObject({
      message: "What if I want it within 2 years?",
      current: { riskTolerance: "medium" },
    });
    expect(body && "history" in body).toBe(false);
  });

  it("an example sends itself", async () => {
    install([says({ changes: [{ field: "noRelocation", value: true, phrase: "won't relocate" }] })]);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "What if I won\u2019t relocate?" }));
    await screen.findByLabelText("Changes applied");
    expect(calls.find((c) => c.path === "/api/whatif")?.body["message"]).toBe("What if I won't relocate?");
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /No relocation/ }).getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("a question can be answered with a button, and the answer carries the question as history", async () => {
    install([
      says({
        clarification: {
          question: "Which minimum pay band do you want?",
          about: "minCompBand",
          options: ["B3", "B4"],
        },
      }),
      says({ changes: [{ field: "minCompBand", value: "B4", phrase: "B4" }] }),
    ]);
    await open();
    await userEvent.type(screen.getByLabelText("What would you like to change?"), "I want more money");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const group = await screen.findByRole("group", { name: "A question about your request" });
    // the buttons say what the band is worth, as a floor; what is sent is still the code the interpreter reads
    await userEvent.click(within(group).getByRole("button", { name: /at least \u20b970 lakh/ }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/whatif")).toHaveLength(2));
    expect(calls.filter((c) => c.path === "/api/whatif")[1]?.body).toMatchObject({
      message: "B4",
      history: [{ question: "Which minimum pay band do you want?", answer: "B4" }],
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "\u20b970L+", pressed: true })).toBeTruthy(),
    );
    // the question has been answered, so its buttons are gone from the earlier turn
    expect(screen.queryByRole("group", { name: "A question about your request" })).toBeNull();
  });

  it("a message the interpreter cannot use changes nothing and says so", async () => {
    install([
      says({
        unsupported: [{ phrase: "a 4-day week", reason: "Work-week length is not in the cohort data." }],
      }),
    ]);
    await open();
    await userEvent.type(screen.getByLabelText("What would you like to change?"), "I want a 4-day week");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Cannot be modelled");
    expect(slider().value).toBe("73");
    await new Promise((r) => setTimeout(r, 250));
    expect(exploreCalls()).toHaveLength(1); // nothing changed, so nothing is asked again
  });

  it("an empty or over-long message is refused on screen without calling the server", async () => {
    install();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Type what you would like to change");
    fireEvent.change(screen.getByLabelText("What would you like to change?"), {
      target: { value: "x".repeat(520) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("520 characters"));
    expect(calls.filter((c) => c.path === "/api/whatif")).toHaveLength(0);
  });

  it("when the model fails the turn shows an error, the limits stay, and the box works again", async () => {
    install([]); // an exhausted scripted model fails the run
    await open();
    await userEvent.type(screen.getByLabelText("What would you like to change?"), "within 2 years");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.length).toBeGreaterThan(5);
    expect(slider().value).toBe("73");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask" }).disabled).toBe(false);
  });

  it("Enter sends and Shift+Enter makes a new line", async () => {
    install([says({})]);
    await open();
    const box = screen.getByLabelText<HTMLTextAreaElement>("What would you like to change?");
    await userEvent.type(box, "hello{Shift>}{Enter}{/Shift}there");
    expect(box.value).toBe("hello\nthere");
    expect(calls.filter((c) => c.path === "/api/whatif")).toHaveLength(0);
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/whatif")).toHaveLength(1));
    await waitFor(() => expect(box.value).toBe(""));
  });
});

describe("what would it take", () => {
  it("a suggestion applies with one click and the limit moves to it", async () => {
    install();
    await open();
    fireEvent.change(slider(), { target: { value: "12" } });
    const button = await screen.findByRole("button", { name: "Try this" });
    expect(screen.getByText(/Raise your time limit from 12 months to 23 months/)).toBeTruthy();
    await userEvent.click(button);
    await waitFor(() => expect(slider().value).toBe("23"));
    await waitFor(() => expect(screen.getByText(/Nothing needs to give/)).toBeTruthy());
  });
});

describe("scenarios", () => {
  it("saves, compares, reopens and removes", async () => {
    install();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario A.");
    fireEvent.change(slider(), { target: { value: "24" } });
    await screen.findByText("Start-here route is now Jump (it was Climb).");
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario B.");
    const table = screen.getByRole("table", { name: "Saved scenarios side by side" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Highest, clearly")).toBeTruthy();
    // Opening the first scenario (no limits) puts the slider back at "No limit".
    const rowA = within(table).getByLabelText("Name of Scenario A").closest("tr") as HTMLElement;
    await userEvent.click(within(rowA).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(slider().value).toBe("73"));
  });

  it("refuses to save the same limits twice and says which scenario has them", async () => {
    install();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario A.");
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("These settings are already saved as Scenario A.");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("does not save while the map is still catching up to the limits", async () => {
    install();
    await open();
    gate = () => new Promise(() => undefined); // the next explore call never answers
    fireEvent.change(slider(), { target: { value: "24" } });
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Wait for the map to finish updating, then save.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opening a scenario restores its limits, and renaming and removing work", async () => {
    install();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario A.");
    fireEvent.change(slider(), { target: { value: "24" } });
    await waitFor(() => expect(exploreCalls().at(-1)?.body["constraints"]).toMatchObject({ maxMonths: 24 }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(slider().value).toBe("73"));
    const name = screen.getByLabelText("Name of Scenario A");
    await userEvent.clear(name);
    await userEvent.type(name, "Stay put{Enter}");
    await screen.findByLabelText("Name of Stay put");
    await userEvent.click(screen.getByRole("button", { name: "Remove Stay put" }));
    await screen.findByText("Nothing saved yet.");
  });
});

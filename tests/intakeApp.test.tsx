// @vitest-environment jsdom
/**
 * The "Your story" tab in a simulated browser: the real components and hooks, the real routes behind a fetch stub, a
 * scripted model. Covers reading, correcting, answering a question, uploading, confirming (which rebuilds the session),
 * failures, and leaving mid-read.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as intakeRoute } from "../src/app/api/intake/route";
import { PathApp } from "../src/components/PathApp";
import { createMockClient, type MockStep } from "../src/lib/model";
import { installServices, resetServices } from "./helpers/api";
import {
  STORY_TEXT,
  emptyReading,
  fullReading,
  partialReading,
  pngBytes,
  yearsReading,
} from "./helpers/intake";

interface Call {
  path: string;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
let calls: Call[];
let gate: Promise<void> | undefined;

function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ path, body, signal: init.signal ?? undefined });
    if (path === "/api/intake" && gate) await gate;
    const handler = path === "/api/intake" ? intakeRoute : exploreRoute;
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
const intakeCalls = () => calls.filter((c) => c.path === "/api/intake");
const exploreCalls = () => calls.filter((c) => c.path === "/api/explore");
const select = (name: string) => screen.getByLabelText<HTMLSelectElement>(name, { exact: false });

async function openStory() {
  const view = render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
  await screen.findByRole("heading", { name: "Tell us about your career" });
  return view;
}
async function readStory(text = STORY_TEXT) {
  fireEvent.change(screen.getByLabelText("Your career in a few lines"), { target: { value: text } });
  await userEvent.click(screen.getByRole("button", { name: "Read it" }));
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

describe("reading", () => {
  it("sends the words, fills the form, and says where each field came from", async () => {
    install([fullReading]);
    await openStory();
    await readStory();
    await screen.findByText("What was read");
    expect(intakeCalls()[0]?.body).toEqual({ text: STORY_TEXT });
    expect(select("Role").value).toBe("backend");
    expect(select("Region").value).toBe("IN-south");
    expect(screen.getByLabelText<HTMLInputElement>(/Years of experience/).value).toBe("7");
    expect(screen.getByText("From your words: \u201c7 years\u201d")).toBeTruthy();
    expect(screen.getByText(/Removed 1 email address/)).toBeTruthy();
  });

  it("an empty box is refused on screen without calling the server", async () => {
    install();
    await openStory();
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Write a few lines");
    expect(intakeCalls()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Your career in a few lines"), { target: { value: "x" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("a model failure is an alert, the form stays usable, and Try again works", async () => {
    install([]); // an exhausted scripted model fails the read
    await openStory();
    await readStory();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.length).toBeGreaterThan(5);
    install([fullReading]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("What was read");
    expect(screen.queryByText(/Something went wrong|try again/i, { selector: "[role=alert] p" })).toBeNull();
  });

  it("a second click while reading does nothing", async () => {
    install([fullReading]);
    let release: (() => void) | undefined;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    await openStory();
    await readStory();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reading\u2026" }).disabled).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reading\u2026" }));
    expect(intakeCalls()).toHaveLength(1);
    release?.();
    await screen.findByText("What was read");
  });

  it("leaving the screen mid-read aborts the request without a React warning", async () => {
    install([fullReading]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let release: (() => void) | undefined;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const view = await openStory();
    await readStory();
    await waitFor(() => expect(intakeCalls()).toHaveLength(1));
    view.unmount();
    expect(intakeCalls()[0]?.signal?.aborted).toBe(true);
    release?.();
    await new Promise((r) => setTimeout(r, 60));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("a question, and the person's corrections", () => {
  it("a partial reading asks; the answer is sent with the corrected form, and the merge keeps the correction", async () => {
    install([partialReading, yearsReading]);
    await openStory();
    await readStory("I'm L5 backend engineer");
    const group = await screen.findByRole("group", { name: "Questions about what is missing" });
    expect(within(group).getByText(/How many years/)).toBeTruthy();
    expect(screen.getAllByText("Needed")).toHaveLength(3);
    await userEvent.selectOptions(select("Region"), "EU-west"); // corrected by hand before answering
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "7 years" } });
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(intakeCalls()).toHaveLength(2));
    const second = intakeCalls()[1]?.body as {
      text: string;
      previous: { draft: Record<string, unknown>; provenance: Record<string, unknown> };
    };
    expect(second.text).toBe("7 years");
    expect(second.previous.draft).toMatchObject({ roleFamily: "backend", level: "L5", region: "EU-west" });
    expect("region" in second.previous.provenance).toBe(false);
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>(/Years of experience/).value).toBe("7"),
    );
    expect(select("Region").value).toBe("EU-west");
    expect(screen.getAllByText("Needed")).toHaveLength(1); // only the goal is still needed
  });
});

describe("uploading a screenshot", () => {
  const upload = () => screen.getByLabelText<HTMLInputElement>("Or upload a cropped screenshot");

  it("a valid picture is named, sent as a data URL, and can be removed", async () => {
    install([fullReading]);
    await openStory();
    const file = new File([pngBytes(200, 200)], "profile.png", { type: "image/png" });
    await userEvent.upload(upload(), file);
    await screen.findByText("Ready to read: profile.png");
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));
    expect(screen.queryByText(/Ready to read/)).toBeNull();
    await userEvent.upload(upload(), file);
    await screen.findByText("Ready to read: profile.png");
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    const body = intakeCalls()[0]?.body as { imageDataUrl: string };
    expect(body.imageDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect("text" in (intakeCalls()[0]?.body ?? {})).toBe(false);
    expect(screen.getByText(/An image is sent to the model as it is/)).toBeTruthy();
  });

  it("a file of the wrong type or too large is refused with the reason, and nothing is chosen", async () => {
    install();
    await openStory();
    fireEvent.change(upload(), {
      target: { files: [new File(["x"], "doc.pdf", { type: "application/pdf" })] },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("PNG, JPEG or WebP");
    expect(screen.queryByText(/Ready to read/)).toBeNull();
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(upload(), { target: { files: [big] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("4 MB"));
    expect(intakeCalls()).toHaveLength(0);
  });
});

describe("confirming", () => {
  it("rebuilds the session for the person: their routes, no sample banner, back on the Map tab, nothing left over from the sample", async () => {
    install([fullReading]);
    await openStory();
    await readStory();
    await screen.findByText("What was read");
    await userEvent.selectOptions(select("Region"), "US-east"); // a correction before confirming
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true"),
    );
    await screen.findByText(/Climb:|Jump:|Pivot:/);
    expect(screen.queryByText(/sample engineer/i)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your route to Staff Engineer");
    const last = exploreCalls().at(-1)?.body as {
      profile: { region: string; roleFamily: string; stack: string[] };
    };
    expect(last.profile).toMatchObject({
      region: "US-east",
      roleFamily: "backend",
      stack: ["go", "kubernetes"],
    });
  });

  it("scenarios and a limit set on the sample do not carry over to the confirmed person", async () => {
    install([fullReading]);
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await screen.findByRole("heading", { name: "Your limits" });
    fireEvent.change(screen.getByLabelText("Time limit"), { target: { value: "24" } });
    await screen.findByText("Start-here route is now Jump (it was Climb).");
    await userEvent.click(screen.getByRole("button", { name: "Save these limits" }));
    await screen.findByText("Saved as Scenario A.");
    await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
    await readStory();
    await screen.findByText("What was read");
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    await screen.findByText(/Climb:|Jump:|Pivot:/);
    await userEvent.click(screen.getByRole("tab", { name: "What if" }));
    await screen.findByRole("heading", { name: "Your limits" });
    expect(screen.getByText("Nothing saved yet.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Time limit").value).toBe("73");
    expect(exploreCalls().at(-1)?.body["constraints"]).toEqual({ riskTolerance: "medium", addSkills: [] });
  });

  it("with required fields missing, lists each problem and changes nothing", async () => {
    install([partialReading]);
    await openStory();
    await readStory("I'm L5 backend engineer");
    await screen.findByText("What was read");
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    const alert = await screen.findByRole("alert", { name: "Fix these first" });
    expect(within(alert).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Your story" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/sample/i, { selector: ".hero__note span" })).toBeTruthy();
  });

  it("works with no reading at all: filling the form by hand is enough", async () => {
    install();
    await openStory();
    await userEvent.selectOptions(select("Role"), "platform");
    await userEvent.selectOptions(select("Current level"), "L4");
    fireEvent.change(screen.getByLabelText(/Years of experience/), { target: { value: "3.5" } });
    await userEvent.selectOptions(select("Region"), "SEA");
    await userEvent.selectOptions(select("Goal level"), "L5");
    expect(screen.getByLabelText<HTMLInputElement>("What you call that goal").value).toBe("Senior Engineer");
    await userEvent.type(screen.getByLabelText("Technologies you work with"), "Rust{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    await screen.findByText(/Climb:|Jump:|Pivot:/);
    expect(intakeCalls()).toHaveLength(0);
    const last = exploreCalls().at(-1)?.body as {
      profile: Record<string, unknown>;
      goal: Record<string, unknown>;
    };
    expect(last.profile).toMatchObject({
      roleFamily: "platform",
      level: "L4",
      yearsExperience: 3.5,
      region: "SEA",
      stack: ["Rust"],
    });
    expect(last.goal).toEqual({ targetLevel: "L5", label: "Senior Engineer" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your route to Senior Engineer");
  });

  it("a story with nothing in it says so and the form still works", async () => {
    install([emptyReading]);
    await openStory();
    await readStory("hello there");
    await screen.findByText(/Nothing about your career could be found/);
    expect(screen.getByRole("button", { name: "Use this for my routes" })).toBeTruthy();
  });
});

describe("the sample banner", () => {
  it("on another tab, a button takes the person to the story tab", async () => {
    install();
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    expect(screen.getByText("You are looking at a sample engineer.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Enter your own story" }));
    expect(screen.getByRole("tab", { name: "Your story" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("You are looking at a sample engineer.")).toBeNull();
  });
});

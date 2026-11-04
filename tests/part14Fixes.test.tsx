// @vitest-environment jsdom
/**
 * Regression tests for the Part 14 review findings (eleven findings and a few doubts from Muse Code's bug hunt), each
 * confirmed by a mutation: the fix is removed, the test fails.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as intakeRoute } from "../src/app/api/intake/route";
import { POST as privacyRoute } from "../src/app/api/privacy/route";
import { PathApp, PathView, TABS } from "../src/components/PathApp";
import { TrailCard } from "../src/components/TrailCard";
import { createMockClient, type MockStep } from "../src/lib/model";
import { COHORT } from "../src/lib/tools/data";
import { EMPTY_FORM, formFromDraft, keepEdits, previousForRead } from "../src/ui/intake";
import { SAMPLE_PERSON } from "../src/ui/sample";
import {
  ROUTE_TEXT_WIDTH,
  CARD_TEXT_WIDTH,
  estimateWidth,
  textFit,
  trailCardModel,
} from "../src/ui/trailCard";
import { installServices, resetServices } from "./helpers/api";
import { STORY_TEXT, fullReading, partialReading, pngBytes, read } from "./helpers/intake";
import { assessed } from "./helpers/privacy";
import { exploreFor } from "./helpers/ui";

const calls: { path: string; body: Record<string, unknown> }[] = [];
function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    calls.push({ path, body: JSON.parse(init.body as string) as Record<string, unknown> });
    const handler =
      path === "/api/intake" ? intakeRoute : path === "/api/privacy" ? privacyRoute : exploreRoute;
    return handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: init.body as string,
      }),
    );
  });
}
function install(steps: MockStep[] = []): void {
  installServices(createMockClient(steps), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
}
const intakeCalls = () => calls.filter((c) => c.path === "/api/intake");
async function openStory() {
  render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
  await screen.findByRole("heading", { name: "Tell us about your career" });
}
const area = () => screen.getByLabelText("Your career in a few lines");
const region = () => screen.getByLabelText<HTMLSelectElement>(/Region/);

beforeEach(() => {
  calls.length = 0;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetServices();
});

describe("a new reading never undoes what the person typed (finding 1)", () => {
  it("pure: previousForRead sends corrections only when there are some; keepEdits lays them over a new reading", async () => {
    const result = await read({ text: STORY_TEXT }, [fullReading]);
    const form = formFromDraft(result.draft);
    expect(previousForRead(result, form)).toBeUndefined(); // untouched: a plain re-read starts fresh
    expect(previousForRead(undefined, EMPTY_FORM)).toBeUndefined();
    const edited = { ...form, region: "US-east" };
    expect(previousForRead(result, edited)?.draft.region).toBe("US-east");
    expect(previousForRead(undefined, { ...EMPTY_FORM, level: "L4" })?.draft.level).toBe("L4"); // hand-filled before any reading
    const fresh = { ...form, region: "IN-south", level: "L6" };
    expect(keepEdits(fresh, edited, form)).toMatchObject({ region: "US-east", level: "L6" });
    expect(keepEdits(fresh, form, form)).toEqual(fresh);
  });

  it("in the app: a corrected region survives pressing Read it again with a new story", async () => {
    install([fullReading, fullReading]);
    await openStory();
    fireEvent.change(area(), { target: { value: STORY_TEXT } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    await userEvent.selectOptions(region(), "US-east");
    fireEvent.change(area(), { target: { value: `${STORY_TEXT} More words.` } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await waitFor(() => expect(intakeCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Read it" })).toBeTruthy());
    expect(region().value).toBe("US-east");
    const second = intakeCalls()[1]?.body as { previous?: { draft: { region?: string } } };
    expect(second.previous?.draft.region).toBe("US-east");
    expect(screen.getAllByText("Entered by you").length).toBeGreaterThan(0);
  });

  it("in the app: fields filled in by hand before the first reading are kept, not replaced", async () => {
    install([partialReading]);
    await openStory();
    await userEvent.selectOptions(screen.getByLabelText<HTMLSelectElement>(/Region/), "SEA");
    fireEvent.change(area(), { target: { value: "I'm L5 backend engineer" } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    expect(region().value).toBe("SEA");
    expect(screen.getByLabelText<HTMLSelectElement>(/Role/).value).toBe("backend"); // and what the reading found is added
  });

  it("in the app: a plain re-read with no corrections starts fresh (no earlier draft is sent)", async () => {
    install([fullReading, fullReading]);
    await openStory();
    fireEvent.change(area(), { target: { value: STORY_TEXT } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await waitFor(() => expect(intakeCalls()).toHaveLength(2));
    expect("previous" in (intakeCalls()[1]?.body ?? {})).toBe(false);
  });
});

describe("the card never runs past its edge (findings 2 and 3)", () => {
  it("textFit adds a squeeze only when the line would not fit", () => {
    expect(textFit("short", 26, CARD_TEXT_WIDTH)).toEqual({});
    const long = textFit("x".repeat(80), 26, CARD_TEXT_WIDTH);
    expect(long).toEqual({ textLength: CARD_TEXT_WIDTH, lengthAdjust: "spacingAndGlyphs" });
    expect(estimateWidth("abcd", 10)).toBeCloseTo(22);
  });
  it("a 60-character goal label and a long details line are squeezed to the card; a short one is left alone", async () => {
    const ladder = await assessed();
    const render = (label: string) => {
      const person = { ...SAMPLE_PERSON, goal: { targetLevel: "L6", label } };
      return renderToStaticMarkup(<TrailCard model={trailCardModel(person, exploreFor().data, ladder)} />);
    };
    const long = render("G".repeat(60));
    expect(long).toContain(`textLength="${CARD_TEXT_WIDTH}"`);
    expect(render("Staff Engineer")).not.toContain(`textLength="${CARD_TEXT_WIDTH}"`);
    expect(long.match(/textLength="1056"/g)?.length).toBeGreaterThanOrEqual(2); // the title and the details line
  });
  it("a route line with 'limited evidence' that would run into the bars is squeezed to the space left of them", async () => {
    const thin = exploreFor(
      {},
      { ...SAMPLE_PERSON, profile: { ...SAMPLE_PERSON.profile, roleFamily: "embedded" } },
    );
    const html = renderToStaticMarkup(
      <TrailCard model={trailCardModel(thin.person, thin.data, await assessed({}, [], thin.person))} />,
    );
    expect(html).toContain(`textLength="${ROUTE_TEXT_WIDTH}"`);
  });
});

describe("a company type with a comma in its name is shown whole (finding 4)", () => {
  it("the server now gives each ladder step its own label", async () => {
    const a = await assessed({ companyType: "robotics" });
    expect(a.ladder.map((r) => r.label)).toEqual(["backend", "L5", "goal L6", "IN-south", "robotics"]);
    expect(a.ladder.every((r) => a.ladder.at(-1)?.shared.includes(r.label))).toBe(true);
  });
});

describe("focus (findings 5 and 6)", () => {
  it("removing a picture puts keyboard focus on the file picker, not on the page", async () => {
    install();
    await openStory();
    const picker = screen.getByLabelText<HTMLInputElement>("Or upload a cropped screenshot");
    await userEvent.upload(picker, new File([pngBytes(200, 200)], "p.png", { type: "image/png" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove picture" }));
    expect(document.activeElement).toBe(picker);
  });
  it("confirming a person moves focus to the page title of the rebuilt screen", async () => {
    install([fullReading]);
    await openStory();
    fireEvent.change(area(), { target: { value: STORY_TEXT } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("page-title"));
    expect(document.activeElement?.tagName).toBe("H1");
  });
  it("the first screen does not steal focus", async () => {
    install();
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the privacy draft is the person's, so it survives the rebuild (finding 7)", () => {
  it("text typed on the Privacy tab is still there after a person is confirmed", async () => {
    install([fullReading]);
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    fireEvent.change(await screen.findByLabelText("Your text"), { target: { value: "my half-written bio" } });
    await userEvent.click(screen.getByRole("tab", { name: "Your story" }));
    fireEvent.change(area(), { target: { value: STORY_TEXT } });
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByText("What was read");
    await userEvent.click(screen.getByRole("button", { name: "Use this for my routes" }));
    await screen.findByText(/Climb:|Jump:|Pivot:/);
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your text").value).toBe("my half-written bio");
  });
});

describe("loading and keyboard (findings 9 and 11)", () => {
  it("the loading skeleton is a status, so its label is read out", () => {
    const { person } = exploreFor();
    const html = renderToStaticMarkup(
      <PathView
        person={person}
        data={undefined}
        error={undefined}
        tab="map"
        selected="climb"
        onTab={() => undefined}
        onSelect={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).toMatch(/role="status" aria-busy="true" aria-label="Loading your routes"/);
  });
  it("Home and End jump to the first and last tab and take focus there", async () => {
    install();
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    const first = TABS[0]?.label ?? "";
    const last = TABS[TABS.length - 1]?.label ?? "";
    screen.getByRole("tab", { name: "Map" }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Map" }), { key: "End" });
    expect(screen.getByRole("tab", { name: last }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: last }));
    fireEvent.keyDown(screen.getByRole("tab", { name: last }), { key: "Home" });
    expect(screen.getByRole("tab", { name: first }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: first }));
  });
  it("other keys do nothing", async () => {
    install();
    render(<PathApp />);
    await screen.findByText(/Climb:/);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Map" }), { key: "a" });
    expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("small things (finding 10 and doubts)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  it("the card-as-text block wraps long lines instead of overflowing on a phone", () => {
    const block = /\.share__text pre \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("white-space: pre-wrap");
    expect(block).toContain("overflow-wrap: anywhere");
  });
  it("the cohort size written on the screen and on the card is the real size of the data", () => {
    expect(COHORT.length).toBe(484);
    const { person, data } = exploreFor();
    const html = renderToStaticMarkup(
      <PathView
        person={person}
        data={data}
        error={undefined}
        tab="map"
        selected="climb"
        onTab={() => undefined}
        onSelect={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain(`Synthetic cohort of ${COHORT.length} engineers`);
  });
});

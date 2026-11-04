// @vitest-environment jsdom
/** The Share tab in a simulated browser: the card follows the privacy settings, and saving and copying behave. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as privacyRoute } from "../src/app/api/privacy/route";
import { PathApp } from "../src/components/PathApp";
import { createMockClient } from "../src/lib/model";
import { installServices, resetServices } from "./helpers/api";

let failPrivacy = false;
function stubFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/privacy" && failPrivacy) return new Response("{}", { status: 502 });
    const handler = path === "/api/privacy" ? privacyRoute : exploreRoute;
    return handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: init.body as string,
      }),
    );
  });
}

async function openShare() {
  render(<PathApp />);
  await screen.findByText(/Climb:/);
  await userEvent.click(screen.getByRole("tab", { name: "Share" }));
  await screen.findByRole("heading", { name: "Share your trail" });
}

beforeEach(() => {
  failPrivacy = false;
  installServices(createMockClient([]), { RATE_LIMIT_PER_MINUTE: "1000", MAX_CONCURRENT_RUNS: "20" });
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetServices();
});

describe("the card", () => {
  it("appears once the privacy count is in, with the safe details and the crowd they leave", async () => {
    await openShare();
    await screen.findByRole("img", { name: /Trail card\. My route to Staff Engineer/ });
    expect(screen.getByText(/Together they match 11 comparable engineers/)).toBeTruthy();
  });

  it("follows the crowd size chosen on the Privacy tab: a bigger crowd withholds details and the card changes", async () => {
    await openShare();
    await screen.findByRole("img", { name: /Trail card/ });
    await userEvent.click(screen.getByRole("tab", { name: "Privacy" }));
    await screen.findByLabelText("How the crowd shrinks as you share more");
    await userEvent.selectOptions(screen.getByLabelText("Stay in a crowd of at least"), "50");
    await userEvent.click(screen.getByRole("tab", { name: "Share" }));
    await screen.findByText(/Left off:/);
    expect(screen.getByText(/South India \(withheld/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Trail card/ }).textContent).not.toContain("South India");
    expect(screen.getByText(/withheld to keep you in a crowd of 50 or more/)).toBeTruthy();
  });

  it("if the privacy count cannot be loaded there is no card, and Try again recovers", async () => {
    failPrivacy = true;
    await openShare();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The card needs the privacy count first",
    );
    expect(screen.queryByRole("img", { name: /Trail card/ })).toBeNull();
    failPrivacy = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("img", { name: /Trail card/ });
  });
});

describe("saving", () => {
  it("Save as SVG downloads a file named for the card and says so", async () => {
    const names: string[] = [];
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await openShare();
    await screen.findByRole("img", { name: /Trail card/ });
    await userEvent.click(screen.getByRole("button", { name: "Save as SVG" }));
    expect(names).toEqual(["my-route-to-staff-engineer.svg"]);
    expect(screen.getByText("Saved as an SVG file.")).toBeTruthy();
  });

  it("Save as picture says plainly when the browser cannot make one", async () => {
    await openShare();
    await screen.findByRole("img", { name: /Trail card/ });
    await userEvent.click(screen.getByRole("button", { name: "Save as picture" }));
    await screen.findByText("This browser cannot make a PNG here. Save it as an SVG instead.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save as picture" }).disabled).toBe(false);
  });

  it("Copy as text puts the card's words on the clipboard, and says if the browser refuses", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (t: string) => (written.push(t), Promise.resolve()) },
    });
    await openShare();
    await screen.findByRole("img", { name: /Trail card/ });
    await userEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await screen.findByText("Copied as text.");
    expect(written[0]).toContain("My route to Staff Engineer");
    expect(written[0]).toContain("Ranges, not promises.");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("no")) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    await waitFor(() => expect(screen.getByText(/would not allow copying/)).toBeTruthy());
  });
});

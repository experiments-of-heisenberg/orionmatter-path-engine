// @vitest-environment jsdom
/** The plan run's guards, tested on the hook itself: things the buttons already prevent, so a screen test cannot reach them. */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exploreRoute } from "../src/app/api/explore/route";
import { POST as planRoute } from "../src/app/api/plan/route";
import { usePathState } from "../src/components/usePathState";
import { createMockClient } from "../src/lib/model";
import { SAMPLE_PERSON } from "../src/ui/sample";
import { installServices, resetServices } from "./helpers/api";
import { compose, criticClean, skipGather } from "./helpers/plan";

let planCalls: number;
let release: (() => void) | undefined;

beforeEach(() => {
  planCalls = 0;
  installServices(createMockClient([skipGather, compose, criticClean]), {
    RATE_LIMIT_PER_MINUTE: "1000",
    MAX_CONCURRENT_RUNS: "20",
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/plan") {
      planCalls++;
      await gate;
    }
    const handler = path === "/api/plan" ? planRoute : exploreRoute;
    return handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: init.body as string,
      }),
    );
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetServices();
});

describe("onBuildPlan", () => {
  it("asked twice in the same moment, starts one run", async () => {
    const { result } = renderHook(() => usePathState(SAMPLE_PERSON));
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => {
      result.current.onBuildPlan();
      result.current.onBuildPlan();
    });
    expect(planCalls).toBe(1);
    release?.();
    await waitFor(() => expect(result.current.plan.phase).toBe("done"));
    expect(planCalls).toBe(1);
  });
});

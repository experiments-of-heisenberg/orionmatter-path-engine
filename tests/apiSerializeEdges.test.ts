/**
 * Edge tests for shaping engine results for the browser (serialize.ts) and for
 * the route work functions (handlers.ts): no leaked internals, route order,
 * skills kept per route, the evidence trail, plan-run shaping, the
 * no-comparable-engineers path, non-mutation, determinism, the unchanged
 * What-if narration, and the exploreExtras default.
 */
import { afterEach, describe, expect, it } from "vitest";
import { noEmit } from "../src/lib/agents";
import { exploreExtras, handleExplore, handleWhatIf } from "../src/lib/api/handlers";
import { PlanRequest, WhatIfRequest } from "../src/lib/api/schemas";
import { evidenceToClient, planToClient, sheetToClient } from "../src/lib/api/serialize";
import { gatherEvidence } from "../src/lib/engine";
import { createMockClient, reply } from "../src/lib/model";
import type { RunPlanOutput } from "../src/lib/orchestrator";
import { EvidenceLedger } from "../src/lib/tools/ledger";
import { installServices, person, resetServices } from "./helpers/api";

afterEach(resetServices);

/** Every key in a nested value, for asserting a name never appears. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value === "object" && value !== null)
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/** The value with every evidence-id field removed, so two runs can be compared. */
function stripIds(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, inner: unknown) =>
      key.toLowerCase().includes("evidenceid") ? undefined : inner,
    ),
  ) as unknown;
}

describe("sheetToClient", () => {
  it("never includes a key named twinIds or stats", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), PlanRequest.parse(person));
    const keys = keysOf(sheetToClient(sheet));
    expect(keys).not.toContain("twinIds");
    expect(keys).not.toContain("stats");
  });

  it("keeps the route order climb, jump, pivot", () => {
    const sheet = gatherEvidence(new EvidenceLedger(), PlanRequest.parse(person));
    expect(sheetToClient(sheet).routes.map((route) => route.archetype)).toEqual(["climb", "jump", "pivot"]);
  });

  it("keeps the asked-for skills on every route when skills were asked", () => {
    const body = PlanRequest.parse({ ...person, constraints: { addSkills: ["go"] } });
    const routes = sheetToClient(gatherEvidence(new EvidenceLedger(), body)).routes;
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect(route.skills).toHaveLength(1);
      expect(route.skills[0]).toMatchObject({ skill: "go" });
    }
  });
});

describe("evidenceToClient", () => {
  it("lists every ledger record once, in call order, with a summary string and no twin ids", () => {
    const ledger = new EvidenceLedger();
    gatherEvidence(ledger, PlanRequest.parse(person));
    const records = ledger.all();
    const client = evidenceToClient(ledger);
    expect(client.map((entry) => entry.evidenceId)).toEqual(records.map((record) => record.evidenceId));
    expect(new Set(client.map((entry) => entry.evidenceId)).size).toBe(client.length);
    expect(client.map((entry) => entry.tool)).toEqual(records.map((record) => record.tool));
    expect(client.length).toBeGreaterThan(0);
    for (const entry of client) {
      expect(typeof entry.summary).toBe("string");
      expect(entry.summary.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(client)).not.toContain("syn_");
  });

  it("returns [] for an empty ledger", () => {
    expect(evidenceToClient(new EvidenceLedger())).toEqual([]);
  });
});

describe("planToClient", () => {
  it("takes status, revisions, repaired and filledIn from the run and keeps the plan object as is", () => {
    const body = PlanRequest.parse(person);
    const sheet = gatherEvidence(new EvidenceLedger(), body);
    const plan = { marker: "the planner output" };
    const verdicts = [{ approved: true, rejections: [], notes: [] }];
    const run = {
      status: "approved",
      revisions: 3,
      plan,
      verdicts,
      sheet,
      ledger: new EvidenceLedger(),
      planner: { filledIn: ["pathStats"], repaired: true },
    } as unknown as RunPlanOutput;
    const client = planToClient(run);
    expect(client.status).toBe("approved");
    expect(client.revisions).toBe(3);
    expect(client.repaired).toBe(true);
    expect(client.filledIn).toEqual(["pathStats"]);
    // The same object, so trivially the same shape as RunPlanOutput.plan.
    expect(client.plan).toBe(plan);
    expect(client.verdicts).toBe(verdicts);
  });
});

describe("handleExplore with no comparable engineers", () => {
  it("does not throw, and returns n 0 routes, a null recommendation and a conflict", () => {
    const body = PlanRequest.parse({
      ...person,
      goal: { targetLevel: "EM2", label: "Engineering Manager 2" },
    });
    const result = handleExplore(body);
    expect(result.twins.n).toBe(0);
    for (const route of result.routes) expect(route.n).toBe(0);
    expect(result.ranking.recommended).toBeNull();
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]?.kind).toBe("infeasible");
  });
});

describe("handleExplore purity and determinism", () => {
  it("does not mutate the request body", () => {
    const body = PlanRequest.parse(person);
    const snapshot = structuredClone(body);
    handleExplore(body);
    expect(body).toEqual(snapshot);
  });

  it("is deterministic: two calls are equal once the random evidence ids are stripped", () => {
    const body = PlanRequest.parse(person);
    const first = handleExplore(body);
    const second = handleExplore(body);
    expect(stripIds(first)).toEqual(stripIds(second));
    // The ids really are random per run, so the stripping above is load-bearing.
    for (const route of first.routes) {
      expect(route.statsEvidenceId).toMatch(/^ev_[0-9a-f]{8}$/);
      expect(route.compEvidenceId).toMatch(/^ev_[0-9a-f]{8}$/);
    }
  });
});

describe("handleWhatIf with an interpreter reply that changes nothing", () => {
  it("returns a template narration saying nothing changed, and an unchanged diff", async () => {
    const { services } = installServices(
      createMockClient([
        reply(JSON.stringify({ changes: [], unsupported: [], contradictions: [], clarification: null })),
      ]),
    );
    const result = await handleWhatIf(services, WhatIfRequest.parse({ ...person, message: "hello" }), noEmit);
    expect(result.narration).toEqual({
      source: "template",
      headline: "Nothing meaningful changed.",
      points: [],
    });
    expect(result.diff.unchanged).toBe(true);
    expect(result.diff.facts).toEqual([]);
    expect(result.diff.recommended.changed).toBe(false);
    expect(result.diff.twins).toEqual({ before: result.diff.twins.before, after: result.diff.twins.before });
  });
});

describe("exploreExtras", () => {
  it("defaults its second argument to body.constraints", () => {
    const body = PlanRequest.parse({ ...person, constraints: { maxMonths: 24 } });
    expect(exploreExtras(body)).toEqual(exploreExtras(body, body.constraints));
  });
});

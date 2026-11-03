/**
 * Tests for the Skeptic's layering and the revision loop, driven by the scripted mock model.
 * These check the contract judges will see: a rejection triggers a targeted revision, every
 * revision is re-audited, numbers never change, and unresolved problems are reported, not hidden.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/lib/agents";
import { assemblePlan, gatherEvidence } from "../src/lib/engine";
import { createMockClient, reply, type ChatRequest, type MockStep } from "../src/lib/model";
import { runPlan } from "../src/lib/orchestrator";
import { auditPlan } from "../src/lib/skeptic";
import { EvidenceLedger } from "../src/lib/tools";
import { draftFromRequest, flawedDraft, input, mlInput, validDraftForSheet } from "./helpers/fixturesData";

const skipGather = reply("EVIDENCE COMPLETE");
const good: MockStep = (request: ChatRequest) => reply(draftFromRequest(request));
const overclaim: MockStep = (request: ChatRequest) =>
  reply(flawedDraft(request, (d) => void (d.routes[0]!.summary = "You will definitely become Staff.")));
const criticClean = reply('{"issues":[],"notes":[]}');

/** Index of the Nth request with a given label prefix. */
const labels = (client: { requests: ChatRequest[] }) => client.requests.map((r) => r.label);

describe("auditPlan (the Skeptic's two layers)", () => {
  function setup() {
    const ledger = new EvidenceLedger();
    const sheet = gatherEvidence(ledger, input);
    return { ledger, sheet, plan: assemblePlan(validDraftForSheet(sheet), sheet) };
  }

  it("skips the critic entirely while the verifier still has findings, and says so", async () => {
    const { ledger, sheet, plan } = setup();
    plan.routes[0]!.summary = "You will win.";
    const client = createMockClient([]); // any model call would throw
    const verdict = await auditPlan({ client }, plan, ledger, sheet);
    expect(verdict.approved).toBe(false);
    expect(verdict.rejections[0]).toMatchObject({
      code: "overclaiming_language",
      source: "verifier",
      routeIndex: 0,
    });
    expect(verdict.notes.join(" ")).toContain("Critic skipped");
    expect(client.requests).toHaveLength(0);
  });

  it("runs the critic once the verifier is clean, and approves when it finds nothing", async () => {
    const { ledger, sheet, plan } = setup();
    const client = createMockClient([criticClean]);
    const verdict = await auditPlan({ client }, plan, ledger, sheet);
    expect(verdict.approved).toBe(true);
    expect(verdict.notes[0]).toBe("Verifier checked 6 claims across 3 routes.");
    expect(client.requests).toHaveLength(1);
  });

  it("rejects when the critic raises a real, quoted problem", async () => {
    const { ledger, sheet, plan } = setup();
    const quote = plan.routes[1]!.steps[0]!.what;
    const client = createMockClient([
      reply(
        JSON.stringify({
          issues: [{ routeIndex: 1, quote, problem: "Needs relocation.", severity: "reject" }],
          notes: [],
        }),
      ),
    ]);
    const verdict = await auditPlan({ client }, plan, ledger, sheet);
    expect(verdict.approved).toBe(false);
    expect(verdict.rejections[0]).toMatchObject({ source: "critic", code: "critic_issue" });
  });

  it("mentions discarded critic issues in the notes so the trace is honest about them", async () => {
    const { ledger, sheet, plan } = setup();
    const client = createMockClient([
      reply(
        JSON.stringify({
          issues: [{ routeIndex: 0, quote: "invented", problem: "x", severity: "reject" }],
          notes: [],
        }),
      ),
    ]);
    const verdict = await auditPlan({ client }, plan, ledger, sheet);
    expect(verdict.approved).toBe(true);
    expect(verdict.notes.join(" ")).toContain("discarded");
  });
});

describe("runPlan: approved on the first audit", () => {
  it("returns an approved plan with no revisions and the right event order", async () => {
    const events: AgentEvent[] = [];
    const client = createMockClient([skipGather, good, criticClean]);
    const out = await runPlan({ client, emit: (e) => events.push(e) }, input);
    expect(out.status).toBe("approved");
    expect(out.revisions).toBe(0);
    expect(out.verdicts).toHaveLength(1);
    const kinds = events
      .filter((e) => e.type === "stage" || e.type === "verdict")
      .map((e) => (e.type === "stage" ? `stage:${e.stage}` : `verdict:${e.approved}`));
    expect(kinds).toEqual([
      "stage:gathering",
      "stage:composing",
      "stage:auditing",
      "verdict:true",
      "stage:done",
    ]);
  });
});

describe("runPlan: a verifier rejection triggers a targeted revision", () => {
  it("revises with the rejection text, re-audits, and approves", async () => {
    const events: AgentEvent[] = [];
    const client = createMockClient([skipGather, overclaim, good, criticClean]);
    const out = await runPlan({ client, emit: (e) => events.push(e) }, input);

    expect(out.status).toBe("approved");
    expect(out.revisions).toBe(1);
    expect(out.verdicts.map((v) => v.approved)).toEqual([false, true]);
    expect(out.verdicts[0]?.rejections[0]).toMatchObject({ code: "overclaiming_language", routeIndex: 0 });

    // The revise request replays the rejected draft and states exactly what was wrong.
    const revise = client.requests.find((r) => r.label === "planner:revise:round1");
    const text = JSON.stringify(revise?.messages);
    expect(text).toContain("You will definitely become Staff.");
    expect(text).toContain("overclaiming_language");
    expect(text).toContain("In the climb route");

    const kinds = events
      .filter((e) => e.type === "stage" || e.type === "verdict")
      .map((e) => (e.type === "stage" ? `${e.stage}${e.round ?? ""}` : `verdict:${e.approved}`));
    expect(kinds).toEqual([
      "gathering",
      "composing",
      "auditing0",
      "verdict:false",
      "revising1",
      "auditing1",
      "verdict:true",
      "done",
    ]);
  });

  it("never changes a number during revision: metrics come from the same fact sheet", async () => {
    const client = createMockClient([skipGather, overclaim, good, criticClean]);
    const out = await runPlan({ client }, input);
    const baseline = gatherEvidence(new EvidenceLedger(), input);
    out.plan.routes.forEach((route, i) => {
      expect(route.metrics.evidenceN).toBe(baseline.routes[i]?.n);
      expect(route.metrics.radar).toEqual(baseline.routes[i]?.radar);
    });
    expect(out.plan.routes[0]?.summary).not.toContain("definitely");
  });

  it("does not call the critic for a round the verifier already rejected", async () => {
    const client = createMockClient([skipGather, overclaim, good, criticClean]);
    await runPlan({ client }, input);
    expect(labels(client).filter((l) => l === "skeptic:critic")).toHaveLength(1); // only for the clean round
  });
});

describe("runPlan: a critic rejection triggers a revision too", () => {
  it("revises after the critic quotes a problem, then approves", async () => {
    let quote = "";
    const criticReject: MockStep = () =>
      reply(
        JSON.stringify({
          issues: [{ routeIndex: 0, quote, problem: "Contradicts the constraints.", severity: "reject" }],
          notes: [],
        }),
      );
    const capture: MockStep = (request) => {
      const draft = draftFromRequest(request);
      quote = (JSON.parse(draft) as { routes: { summary: string }[] }).routes[0]!.summary;
      return reply(draft);
    };
    const client = createMockClient([skipGather, capture, criticReject, good, criticClean]);
    const out = await runPlan({ client }, input);
    expect(out.status).toBe("approved");
    expect(out.revisions).toBe(1);
    expect(out.verdicts[0]?.rejections[0]).toMatchObject({ source: "critic" });
    expect(
      JSON.stringify(client.requests.find((r) => r.label === "planner:revise:round1")?.messages),
    ).toContain("Contradicts the constraints.");
  });
});

describe("runPlan: limits and honesty", () => {
  it("stops after two revisions, re-audits the last one, and reports 'unresolved' with the problems", async () => {
    const client = createMockClient([skipGather, overclaim, overclaim, overclaim]);
    const out = await runPlan({ client }, input);
    expect(out.status).toBe("unresolved");
    expect(out.revisions).toBe(2);
    expect(out.verdicts).toHaveLength(3); // initial + one audit after each revision: never returned unchecked
    expect(out.verdicts.at(-1)?.rejections[0]?.code).toBe("overclaiming_language");
    expect(out.plan.routes).toHaveLength(3); // the plan is still returned, flagged, not discarded
    expect(client.remaining).toBe(0);
  });

  it("honours maxRevisions: 0 by auditing once and not revising", async () => {
    const client = createMockClient([skipGather, overclaim]);
    const out = await runPlan({ client, maxRevisions: 0 }, input);
    expect(out.status).toBe("unresolved");
    expect(out.revisions).toBe(0);
    expect(labels(client).some((l) => l.startsWith("planner:revise"))).toBe(false);
  });

  it("handles a thin scenario end to end", async () => {
    const client = createMockClient([skipGather, good, criticClean]);
    const out = await runPlan({ client }, mlInput);
    expect(out.status).toBe("approved");
    expect(out.plan.routes[2]?.evidenceThin).toBe(true);
  });

  it("emits the verdict with its rejections so the UI can show them", async () => {
    const events: AgentEvent[] = [];
    const client = createMockClient([skipGather, overclaim, good, criticClean]);
    await runPlan({ client, emit: (e) => events.push(e) }, input);
    const first = events.find((e) => e.type === "verdict");
    expect(first).toMatchObject({ type: "verdict", round: 0, approved: false });
    expect(first?.type === "verdict" && first.rejections[0]?.reason).toContain("promise");
  });
});

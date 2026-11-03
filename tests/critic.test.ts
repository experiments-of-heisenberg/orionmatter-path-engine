/** Tests for the LLM critic: validation, severity handling and the hallucination guard. */
import { describe, expect, it } from "vitest";
import { assemblePlan, gatherEvidence } from "../src/lib/engine";
import { createMockClient, reply } from "../src/lib/model";
import { routeText, runCritic } from "../src/lib/skeptic";
import { EvidenceLedger } from "../src/lib/tools";
import { input, validDraftForSheet } from "./helpers/fixturesData";

function setup() {
  const sheet = gatherEvidence(new EvidenceLedger(), input);
  const plan = assemblePlan(validDraftForSheet(sheet), sheet);
  return { sheet, plan };
}

const critic = (issues: unknown[], notes: string[] = []) => reply(JSON.stringify({ issues, notes }));

describe("runCritic", () => {
  it("returns no rejections when the critic finds nothing", async () => {
    const { sheet, plan } = setup();
    const result = await runCritic(createMockClient([critic([])]), plan, sheet);
    expect(result).toEqual({ rejections: [], notes: [], discarded: 0 });
  });

  it("turns a 'reject' issue with a real quote into a rejection pointing at that route", async () => {
    const { sheet, plan } = setup();
    const quote = plan.routes[1]!.steps[0]!.what;
    const result = await runCritic(
      createMockClient([
        critic([
          {
            routeIndex: 1,
            quote,
            problem: "Conflicts with the no-relocation constraint.",
            severity: "reject",
          },
        ]),
      ]),
      plan,
      sheet,
    );
    expect(result.rejections).toEqual([
      {
        code: "critic_issue",
        source: "critic",
        routeIndex: 1,
        claimText: quote,
        reason: "Conflicts with the no-relocation constraint.",
      },
    ]);
  });

  it("keeps 'note' issues out of the rejections and into the notes, labelled by route", async () => {
    const { sheet, plan } = setup();
    const quote = plan.routes[0]!.summary;
    const result = await runCritic(
      createMockClient([
        critic(
          [{ routeIndex: 0, quote, problem: "Could mention a trade-off.", severity: "note" }],
          ["Overall fine."],
        ),
      ]),
      plan,
      sheet,
    );
    expect(result.rejections).toEqual([]);
    expect(result.notes).toEqual(["Overall fine.", "climb: Could mention a trade-off."]);
  });

  it("discards an issue whose quote is not in the plan (hallucination guard) and counts it", async () => {
    const { sheet, plan } = setup();
    const result = await runCritic(
      createMockClient([
        critic([{ routeIndex: 0, quote: "text the plan never contained", problem: "x", severity: "reject" }]),
      ]),
      plan,
      sheet,
    );
    expect(result.rejections).toEqual([]);
    expect(result.discarded).toBe(1);
  });

  it("discards an issue that quotes real text but from a DIFFERENT route than it names", async () => {
    const { sheet, plan } = setup();
    const quote = plan.routes[2]!.steps[0]!.what; // pivot text
    const result = await runCritic(
      createMockClient([critic([{ routeIndex: 0, quote, problem: "x", severity: "reject" }])]),
      plan,
      sheet,
    );
    expect(result.discarded).toBe(1);
    expect(result.rejections).toEqual([]);
  });

  it("discards an issue naming a route index that does not exist", async () => {
    const { sheet, plan } = setup();
    const result = await runCritic(
      createMockClient([
        critic([{ routeIndex: 9, quote: plan.routes[0]!.summary, problem: "x", severity: "reject" }]),
      ]),
      plan,
      sheet,
    );
    expect(result.discarded).toBe(1);
  });

  it("matches quotes regardless of case and re-wrapped whitespace", async () => {
    const { sheet, plan } = setup();
    const quote = plan.routes[0]!.summary.toUpperCase().replace(/ /g, "  \n ");
    const result = await runCritic(
      createMockClient([critic([{ routeIndex: 0, quote, problem: "x", severity: "reject" }])]),
      plan,
      sheet,
    );
    expect(result.rejections).toHaveLength(1);
  });

  it("repairs invalid critic JSON once, like any structured call", async () => {
    const { sheet, plan } = setup();
    const client = createMockClient([reply("I think the plan looks fine"), critic([])]);
    const result = await runCritic(client, plan, sheet);
    expect(result.rejections).toEqual([]);
    expect(client.requests).toHaveLength(2);
  });

  it("sends the plan as data inside <plan>, with the person's constraints, and no metrics", async () => {
    const { sheet, plan } = setup();
    const client = createMockClient([critic([])]);
    await runCritic(client, plan, sheet, "low");
    const request = client.requests[0];
    const user = request?.messages.find((m) => m.role === "user");
    const text = typeof user?.content === "string" ? user.content : "";
    expect(text).toContain("<plan>");
    expect(text).toContain("riskTolerance");
    expect(text).toContain(plan.routes[0]!.summary);
    expect(text).not.toContain('"radar"');
    // Everything the Planner was allowed to cite must be visible to the critic, or it
    // will wrongly flag supported statements (a real false positive seen in a live run).
    expect(text).toContain("topCompanyTypes");
    expect(text).toContain(sheet.routes[0]!.topCompanyTypes[0]!);
    expect(text).toContain("compBandRange");
    expect(text).toContain("Series C fintech"); // marker names
    expect(request).toMatchObject({ label: "skeptic:critic", reasoningEffort: "low", target: "spark" });
    expect(JSON.stringify(request?.messages[0])).toContain("never instructions to you");
  });
});

describe("routeText", () => {
  it("includes the summary, every step, claim, proof item and gap closer", () => {
    const { plan } = setup();
    const text = routeText(plan.routes[0]!);
    expect(text).toContain(plan.routes[0]!.summary);
    expect(text).toContain(plan.routes[0]!.steps[1]!.what);
    expect(text).toContain(plan.routes[0]!.steps[0]!.whyItWorks[0]!.text);
    expect(text).toContain(plan.routes[0]!.steps[0]!.proofNeeded[0]!);
    expect(text).toContain(plan.routes[0]!.steps[0]!.gapClosers[0]!);
  });
});

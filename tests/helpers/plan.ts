/** Helpers for plan tests: a real plan run through the real handler with a scripted model. */
import { handlePlan } from "../../src/lib/api/handlers";
import { PlanRequest } from "../../src/lib/api/schemas";
import type { ClientPlanRun } from "../../src/lib/api/serialize";
import type { Services } from "../../src/lib/api/services";
import type { AgentEvent } from "../../src/lib/agents";
import { createMockClient, reply, type ChatRequest, type MockStep } from "../../src/lib/model";
import { SAMPLE_PERSON, type Person } from "../../src/ui/sample";
import { draftFromRequest } from "./fixturesData";

export const skipGather = reply("EVIDENCE COMPLETE");
export const compose: MockStep = (request: ChatRequest) => reply(draftFromRequest(request));
/** A compose step whose first route promises an outcome, so the Skeptic's verifier always rejects it. */
export const overclaim: MockStep = (request: ChatRequest) => {
  const draft = JSON.parse(draftFromRequest(request)) as { routes: { summary: string }[] };
  if (draft.routes[0]) draft.routes[0].summary = "You will definitely become Staff.";
  return reply(JSON.stringify(draft));
};
export const criticClean = reply('{"issues":[],"notes":[]}');

/** An approved plan run for a person, with every event the run emitted. */
export async function approvedPlan(
  person: Person = SAMPLE_PERSON,
): Promise<{ result: ClientPlanRun; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  const request = PlanRequest.parse(person);
  const result = await handlePlan(
    { client: createMockClient([skipGather, compose, criticClean]) } as unknown as Services,
    request,
    (event) => events.push(event),
  );
  return { result, events };
}

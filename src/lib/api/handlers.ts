/**
 * handlers.ts: what each route does, as plain functions of (services, validated body).
 *
 * The route files only bind these to a URL, a schema and the guards in route.ts. Keeping the work here
 * makes it testable with a scripted model and no HTTP at all.
 */
import type { Emit } from "../agents";
import { gatherEvidence } from "../engine";
import { runIntake, type IntakeResult } from "../intake";
import { runPlan } from "../orchestrator";
import { assessPrivacy } from "../privacy";
import { EvidenceLedger } from "../tools/ledger";
import { evidenceConflicts, runWhatIf, sensitivityTornado, whatWouldItTake } from "../whatif";
import type { IntakeRequest, PlanRequest, PrivacyRequest, WhatIfRequest } from "./schemas";
import { planToClient, sheetToClient, type ClientPlanRun, type ClientSheet } from "./serialize";
import type { Services } from "./services";

/** POST /api/intake */
export function handleIntake(services: Services, body: IntakeRequest, emit: Emit): Promise<IntakeResult> {
  return runIntake(
    { client: services.client, emit },
    {
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.imageDataUrl !== undefined ? { imageDataUrl: body.imageDataUrl } : {}),
      ...(body.previous ? { previous: body.previous } : {}),
    },
  );
}

/** POST /api/plan: the full Planner and Skeptic run. */
export async function handlePlan(services: Services, body: PlanRequest, emit: Emit): Promise<ClientPlanRun> {
  const out = await runPlan({ client: services.client, emit }, body);
  return planToClient(out);
}

/** The deterministic extras shown beside any plan: the tornado and the smallest changes that would help. */
export function exploreExtras(body: PlanRequest, constraints = body.constraints) {
  const input = { profile: body.profile, goal: body.goal, constraints };
  return { tornado: sensitivityTornado(input), wouldItTake: whatWouldItTake(input) };
}

/** POST /api/explore: the fast path, no model. Sliders call this on every change. */
export function handleExplore(
  body: PlanRequest,
): ClientSheet & ReturnType<typeof exploreExtras> & { conflicts: ReturnType<typeof evidenceConflicts> } {
  const sheet = gatherEvidence(new EvidenceLedger(), {
    profile: body.profile,
    goal: body.goal,
    constraints: body.constraints,
  });
  return {
    ...sheetToClient(sheet),
    ...exploreExtras(body),
    conflicts: evidenceConflicts(sheet, body.constraints),
  };
}

/** POST /api/whatif: interpret a sentence, recompute, diff, explain, and add the tornado for the new constraints. */
export async function handleWhatIf(services: Services, body: WhatIfRequest, emit: Emit) {
  const run = await runWhatIf(
    { client: services.client, emit, ...(body.narrate !== undefined ? { narrate: body.narrate } : {}) },
    {
      message: body.message,
      current: body.current,
      profile: body.profile,
      goal: body.goal,
      ...(body.history ? { history: body.history } : {}),
    },
  );
  const next = { profile: body.profile, goal: body.goal, constraints: run.interpretation.next };
  return {
    interpretation: run.interpretation,
    before: sheetToClient(run.before),
    after: sheetToClient(run.after),
    diff: run.diff,
    narration: run.narration,
    ...exploreExtras({ ...next }, run.interpretation.next),
  };
}

/** POST /api/privacy */
export function handlePrivacy(services: Services, body: PrivacyRequest, emit: Emit) {
  return assessPrivacy(
    { client: services.client, emit },
    {
      profile: body.profile,
      goal: body.goal,
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.companyType !== undefined ? { companyType: body.companyType } : {}),
      ...(body.k !== undefined ? { k: body.k } : {}),
      ...(body.useModel !== undefined ? { useModel: body.useModel } : {}),
    },
  );
}

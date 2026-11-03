/**
 * orchestrator.ts: the full planning pipeline, Planner then Skeptic then revisions.
 *
 *   plan  = Planner(person, goal, constraints)
 *   audit = Skeptic(plan)                      round 0
 *   while rejected and revisions remain:
 *       draft = Planner.revise(draft, rejections)
 *       audit = Skeptic(plan)                  every revision is re-audited
 *
 * The loop audits AFTER the last revision, so a plan is never returned unchecked. If the
 * limit is reached with problems remaining the plan is still returned, marked
 * "unresolved" together with the outstanding rejections. It is never silently presented as
 * verified: the UI must show which claims did not pass.
 */
import { assemblePlan } from "./engine";
import type { EngineInput, FactSheet } from "./engine";
import { noEmit, revisePlan, runPlanner, type Emit, type PlannerOutput } from "./agents";
import type { ModelClient, ReasoningEffort } from "./model";
import type { PlanResult, SkepticVerdict } from "./schemas";
import { auditPlan } from "./skeptic";
import type { EvidenceLedger } from "./tools/ledger";

export interface RunPlanDeps {
  client: ModelClient;
  emit?: Emit;
  /** Maximum revisions after the first plan. Default 2. */
  maxRevisions?: number;
  reasoning?: { gather?: ReasoningEffort; compose?: ReasoningEffort; critic?: ReasoningEffort };
}

export interface RunPlanOutput {
  plan: PlanResult;
  sheet: FactSheet;
  ledger: EvidenceLedger;
  /** One verdict per audit: index 0 is the first plan, then one per revision. */
  verdicts: SkepticVerdict[];
  /** "approved" when the final audit has no rejections; otherwise "unresolved". */
  status: "approved" | "unresolved";
  /** How many revisions were needed. */
  revisions: number;
  /** The Planner's first-pass output (draft, filled-in tools, repair info). */
  planner: PlannerOutput;
}

/**
 * Run the whole pipeline for one person.
 *
 * @param deps   model client, optional trace emitter and tuning
 * @param input  person, goal and constraints
 * @param ledger optional existing ledger
 */
export async function runPlan(
  deps: RunPlanDeps,
  input: EngineInput,
  ledger?: EvidenceLedger,
): Promise<RunPlanOutput> {
  const emit = deps.emit ?? noEmit;
  const maxRevisions = deps.maxRevisions ?? 2;
  const plannerDeps = { client: deps.client, emit, reasoning: deps.reasoning };

  const planner = await runPlanner(plannerDeps, input, ledger);
  const { sheet } = planner;
  let draft = planner.draft;
  let plan = planner.plan;
  const verdicts: SkepticVerdict[] = [];

  for (let round = 0; ; round++) {
    emit({ type: "stage", stage: "auditing", round });
    const verdict = await auditPlan(
      { client: deps.client, criticEffort: deps.reasoning?.critic },
      plan,
      planner.ledger,
      sheet,
    );
    verdicts.push(verdict);
    emit({
      type: "verdict",
      round,
      approved: verdict.approved,
      rejections: verdict.rejections,
      notes: verdict.notes,
    });

    if (verdict.approved || round >= maxRevisions) break;

    emit({ type: "stage", stage: "revising", round: round + 1 });
    draft = (await revisePlan(plannerDeps, { sheet, draft, verdict, round: round + 1 })).draft;
    plan = assemblePlan(draft, sheet);
  }

  emit({ type: "stage", stage: "done" });
  const last = verdicts[verdicts.length - 1];
  return {
    plan,
    sheet,
    ledger: planner.ledger,
    verdicts,
    status: last?.approved ? "approved" : "unresolved",
    revisions: verdicts.length - 1,
    planner,
  };
}

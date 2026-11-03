/**
 * skeptic.ts: the Skeptic agent. Audits a plan in two layers and returns a verdict.
 *
 *   Layer 1 (code)   the deterministic verifier. Cheap, instant, and exact.
 *   Layer 2 (model)  the LLM critic. Slower, so it runs only once layer 1 is clean:
 *                    there is no point asking a model for subtle judgement on a plan
 *                    that still has provable mechanical errors.
 */
import type { FactSheet } from "../engine";
import type { ModelClient, ReasoningEffort } from "../model";
import type { PlanResult, SkepticVerdict } from "../schemas";
import type { EvidenceLedger } from "../tools/ledger";
import { runCritic } from "./critic";
import { toRejections } from "./findings";
import { verifyPlan } from "./verifier";

export interface AuditDeps {
  client: ModelClient;
  /** Reasoning effort for the critic. Defaults to minimal. */
  criticEffort?: ReasoningEffort;
}

/**
 * Audit a plan.
 *
 * @param deps   model client (used only by the critic)
 * @param plan   the assembled plan
 * @param ledger the ledger the plan was built from
 * @param sheet  the fact sheet behind the plan
 * @returns a verdict: approved when no rejections remain
 */
export async function auditPlan(
  deps: AuditDeps,
  plan: PlanResult,
  ledger: EvidenceLedger,
  sheet: FactSheet,
): Promise<SkepticVerdict> {
  const report = verifyPlan(plan, ledger, sheet);
  const notes = [`Verifier checked ${report.claimsChecked} claims across ${plan.routes.length} routes.`];

  if (report.findings.length > 0) {
    notes.push("Critic skipped: fix the mechanical problems first.");
    return { approved: false, rejections: toRejections(report.findings), notes };
  }

  const critic = await runCritic(deps.client, plan, sheet, deps.criticEffort);
  notes.push(...critic.notes);
  if (critic.discarded > 0)
    notes.push(`Critic raised ${critic.discarded} issue(s) quoting text that is not in the plan; discarded.`);
  return { approved: critic.rejections.length === 0, rejections: critic.rejections, notes };
}

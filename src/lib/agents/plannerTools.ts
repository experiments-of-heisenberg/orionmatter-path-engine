/**
 * plannerTools.ts: the tools the Planner model can call, and the code that runs them.
 *
 * These are a model-facing VIEW of the deterministic tools, shaped to prevent mistakes:
 *   - findTwins takes no profile: the executor injects the real user's profile, goal and
 *     constraints, so the model can never retype (or subtly alter) them.
 *   - pathStats takes `twinsEvidenceId` instead of a list of twin ids, so the model never
 *     has to copy 150 ids correctly.
 * Everything the model sends is untrusted and validated before use. Every call goes
 * through the EvidenceLedger so its result gets a citable evidence id.
 */
import { z } from "zod";
import { summarizeEvidence, type EngineInput } from "../engine";
import { toolDefinition, type ToolDefinition, type ToolExecutor } from "../model";
import { Archetype } from "../schemas";
import type { AnyEvidence, EvidenceLedger } from "../tools/ledger";
import { ToolArgSchemas } from "../tools/toolSchemas";
import type { Emit } from "./events";

/** Optional exploration knobs. The user's own constraints are the baseline. */
const FindTwinsArgs = z.object({ remote: z.boolean().optional(), noRelocation: z.boolean().optional() });

const PathStatsArgs = z.object({
  twinsEvidenceId: z.string().describe("The evidenceId returned by findTwins."),
  archetype: Archetype,
});

/** Tool definitions shown to the model. */
export const PLANNER_TOOLS: ToolDefinition[] = [
  toolDefinition(
    "findTwins",
    "Find comparable engineers ('twins') in the synthetic cohort for the person you are planning for. " +
      "Their profile, goal and constraints are supplied automatically, so call it with no arguments. " +
      "Optionally set remote or noRelocation to explore a variant. Returns an evidenceId and n, the number of twins.",
    FindTwinsArgs,
  ),
  toolDefinition(
    "pathStats",
    "Summarise what happened to twins on one route archetype (climb, jump or pivot): sample size n, " +
      "the range of months to reach the goal, the success-rate interval, comp band range, risks and skill gates. " +
      "Requires the evidenceId returned by findTwins.",
    PathStatsArgs,
  ),
  toolDefinition(
    "compBands",
    "Compensation band range (B1 lowest to B5 highest) for engineers who reached a level in a region.",
    ToolArgSchemas.compBands,
  ),
];

/** Turn a successful evidence record into the JSON the model sees. */
function resultForModel(evidence: AnyEvidence): string {
  if (evidence.tool === "findTwins") {
    // Omit the id list: the model references twins by evidenceId, not by copying ids.
    return JSON.stringify({
      evidenceId: evidence.evidenceId,
      n: evidence.result.n,
      next: "Pass this evidenceId as twinsEvidenceId to pathStats for climb, jump and pivot.",
    });
  }
  return JSON.stringify({ evidenceId: evidence.evidenceId, ...evidence.result });
}

/**
 * Build the executor the tool loop uses for the Planner.
 *
 * @param ledger session ledger that records every call
 * @param input  the real person, goal and constraints being planned for
 * @param emit   trace sink; each call and result is reported
 */
export function createPlannerExecutor(ledger: EvidenceLedger, input: EngineInput, emit: Emit): ToolExecutor {
  /** Report a failed call to both the trace and the model. */
  const fail = (id: string, name: string, error: string): string => {
    emit({ type: "tool_result", id, name, summary: `${name}: ${error}`, isError: true, by: "agent" });
    return JSON.stringify({ error });
  };

  return ({ id, name, args }) => {
    emit({ type: "tool_call", id, name, args, by: "agent" });

    let outcome: { ok: true; evidence: AnyEvidence } | { ok: false; error: string };

    if (name === "findTwins") {
      const parsed = FindTwinsArgs.safeParse(args ?? {});
      if (!parsed.success) return fail(id, name, z.prettifyError(parsed.error));
      // Variants only override the two knobs that affect twin matching.
      const constraints = { ...input.constraints, ...parsed.data };
      outcome = ledger.callUntrusted("findTwins", { profile: input.profile, goal: input.goal, constraints });
    } else if (name === "pathStats") {
      const parsed = PathStatsArgs.safeParse(args);
      if (!parsed.success) return fail(id, name, z.prettifyError(parsed.error));
      const twins = ledger.get(parsed.data.twinsEvidenceId);
      if (twins?.tool !== "findTwins") {
        return fail(id, name, `"${parsed.data.twinsEvidenceId}" is not the evidenceId of a findTwins call.`);
      }
      outcome = ledger.callUntrusted("pathStats", {
        twinIds: twins.result.twinIds,
        archetype: parsed.data.archetype,
      });
    } else if (name === "compBands") {
      outcome = ledger.callUntrusted("compBands", args);
    } else {
      return fail(id, name, `Unknown tool "${name}". Available tools: findTwins, pathStats, compBands.`);
    }

    if (!outcome.ok) return fail(id, name, outcome.error);
    emit({
      type: "tool_result",
      id,
      name,
      summary: summarizeEvidence(outcome.evidence),
      isError: false,
      by: "agent",
      evidenceId: outcome.evidence.evidenceId,
    });
    return resultForModel(outcome.evidence);
  };
}

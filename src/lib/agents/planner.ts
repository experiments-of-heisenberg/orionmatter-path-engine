/**
 * planner.ts: the Planner agent.
 *
 * Turns (profile, goal, constraints) into a PlanResult with three routes. The flow:
 *
 *   GATHER   The model chooses which tools to call (findTwins, pathStats, compBands).
 *            Every call goes through the evidence ledger and is reported to the trace.
 *   COMPLETE Code checks that the evidence the plan needs exists, and runs anything the
 *            model skipped. The agent decides what to look at; it cannot leave a gap.
 *   COMPOSE  The model writes each route's summary and steps around a fact sheet. It
 *            writes words only: metrics and radar are computed by code and merged in.
 *
 * Auditing and revision (the Skeptic) is Part 5; this module returns the first plan.
 */
import { assemblePlan, gatherEvidence, PlanDraft, type EngineInput, type FactSheet } from "../engine";
import { chatStructured, runToolLoop, type ModelClient, type ReasoningEffort } from "../model";
import type { PlanResult, SkepticVerdict } from "../schemas";
import { EvidenceLedger } from "../tools/ledger";
import { summarizeEvidence } from "../engine";
import { noEmit, type Emit } from "./events";
import { PLANNER_TOOLS, createPlannerExecutor } from "./plannerTools";
import {
  COMPOSE_SYSTEM_PROMPT,
  GATHER_SYSTEM_PROMPT,
  composeUserMessage,
  gatherUserMessage,
  revisionUserMessage,
} from "./plannerPrompts";

export interface PlannerDeps {
  client: ModelClient;
  /** Trace sink. Defaults to discarding events. */
  emit?: Emit;
  /**
   * Reasoning effort per phase. Effort is the speed/cost dial: Muse Spark's hidden
   * reasoning dominates latency, and composing text around computed facts needs little
   * of it. Defaults come from live measurements (see docs/parts/part-4-planner.md).
   */
  reasoning?: { gather?: ReasoningEffort; compose?: ReasoningEffort };
}

/** Defaults chosen from live measurements; override through PlannerDeps.reasoning. */
const DEFAULT_GATHER_EFFORT: ReasoningEffort = "low";
const DEFAULT_COMPOSE_EFFORT: ReasoningEffort = "minimal";

export interface PlannerOutput {
  plan: PlanResult;
  /** The code-computed facts behind the plan. */
  sheet: FactSheet;
  /** The model's draft before code merged in the metrics. */
  draft: PlanDraft;
  /** Ledger holding every tool call; the Skeptic verifies claims against it. */
  ledger: EvidenceLedger;
  /** Model tool calls during gathering. */
  agentToolCalls: number;
  /** Tools code had to run because the model skipped them. */
  filledIn: string[];
  /** True when the composition needed its one repair retry. */
  repaired: boolean;
  /** True when the draft had a short stray tail dropped to make it parseable (see parseModelJson). */
  recovered: boolean;
  /** Why the first draft was rejected, when it was. Useful for tuning the prompt. */
  repairReason?: string;
}

/**
 * Run the Planner.
 *
 * @param deps   model client and optional trace emitter
 * @param input  the person, goal and constraints
 * @param ledger optional existing ledger (the revision loop reuses it); a new one by default
 */
export async function runPlanner(
  deps: PlannerDeps,
  input: EngineInput,
  ledger: EvidenceLedger = new EvidenceLedger(),
): Promise<PlannerOutput> {
  const { client } = deps;
  const emit = deps.emit ?? noEmit;

  // ---- GATHER: the model drives tool use ----
  emit({ type: "stage", stage: "gathering" });
  const gathering = await runToolLoop({
    client,
    request: {
      label: "planner:gather",
      target: "spark",
      reasoningEffort: deps.reasoning?.gather ?? DEFAULT_GATHER_EFFORT,
      maxCompletionTokens: 3000,
      tools: PLANNER_TOOLS,
      messages: [
        { role: "system", content: GATHER_SYSTEM_PROMPT },
        { role: "user", content: gatherUserMessage({ ...input }) },
      ],
    },
    execute: createPlannerExecutor(ledger, input, emit),
    maxToolCalls: 8,
    onEvent: (event) => {
      if (event.type === "limit_reached")
        emit({ type: "note", message: `Tool call limit (${event.maxToolCalls}) reached.` });
    },
  });

  // ---- COMPLETE: code fills any gap the model left ----
  const idsBefore = new Set(ledger.all().map((evidence) => evidence.evidenceId));
  const sheet = gatherEvidence(ledger, input);
  const added = ledger.all().filter((evidence) => !idsBefore.has(evidence.evidenceId));
  if (added.length > 0) {
    emit({
      type: "note",
      message: `The model skipped ${added.length} needed lookup(s); the engine ran them.`,
    });
    for (const evidence of added) {
      emit({
        type: "tool_call",
        id: evidence.evidenceId,
        name: evidence.tool,
        args: evidence.args,
        by: "engine",
      });
      emit({
        type: "tool_result",
        id: evidence.evidenceId,
        name: evidence.tool,
        summary: summarizeEvidence(evidence),
        isError: false,
        by: "engine",
        evidenceId: evidence.evidenceId,
      });
    }
  }

  // ---- COMPOSE: the model writes words around the fact sheet ----
  emit({ type: "stage", stage: "composing" });
  const composed = await chatStructured(
    client,
    {
      label: "planner:compose",
      target: "spark",
      reasoningEffort: deps.reasoning?.compose ?? DEFAULT_COMPOSE_EFFORT,
      maxCompletionTokens: 8000,
      messages: [
        { role: "system", content: COMPOSE_SYSTEM_PROMPT },
        { role: "user", content: composeUserMessage(sheet) },
      ],
    },
    PlanDraft,
  );

  return {
    plan: assemblePlan(composed.data, sheet),
    sheet,
    draft: composed.data,
    ledger,
    agentToolCalls: gathering.toolCallCount,
    filledIn: sheet.filledIn,
    repaired: composed.repaired,
    recovered: composed.recovered,
    ...(composed.repairReason ? { repairReason: composed.repairReason } : {}),
  };
}

/** Inputs for a revision. */
export interface ReviseArgs {
  sheet: FactSheet;
  /** The draft the Skeptic rejected. */
  draft: PlanDraft;
  verdict: SkepticVerdict;
  /** 1 for the first revision, 2 for the second. Used in labels. */
  round: number;
}

/**
 * Ask the Planner to fix a rejected draft.
 *
 * The conversation replays the original request, the model's rejected draft as its own
 * previous answer, and the Skeptic's rejections. The fact sheet does not change: only the
 * words are rewritten, so the evidence and numbers stay exactly the same.
 */
export async function revisePlan(
  deps: PlannerDeps,
  args: ReviseArgs,
): Promise<{ draft: PlanDraft; repaired: boolean }> {
  const { data, repaired } = await chatStructured(
    deps.client,
    {
      label: `planner:revise:round${args.round}`,
      target: "spark",
      reasoningEffort: deps.reasoning?.compose ?? DEFAULT_COMPOSE_EFFORT,
      maxCompletionTokens: 8000,
      messages: [
        { role: "system", content: COMPOSE_SYSTEM_PROMPT },
        { role: "user", content: composeUserMessage(args.sheet) },
        { role: "assistant", content: JSON.stringify(args.draft) },
        { role: "user", content: revisionUserMessage(args.verdict) },
      ],
    },
    PlanDraft,
  );
  return { draft: data, repaired };
}

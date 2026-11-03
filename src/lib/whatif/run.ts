/**
 * run.ts: one What-if turn, end to end.
 *
 *   message -> interpret -> plan BEFORE and AFTER (deterministic) -> diff -> explanation
 *
 * The before/after plans are computed by the engine's fast path with ONE shared evidence
 * ledger, so a route whose inputs did not change keeps the same evidence ids and is reported
 * as unchanged. No model is involved in the numbers; the model only reads the message and
 * phrases the explanation (and the explanation falls back to a template if it cannot be verified).
 *
 * The full Planner + Skeptic run for the NEW constraints is a separate, slower call
 * (`runPlan`), triggered by the interface after this returns so the map can redraw first.
 */
import { noEmit, type Emit } from "../agents/events";
import { gatherEvidence, type FactSheet } from "../engine";
import type { ModelClient } from "../model";
import { EvidenceLedger } from "../tools/ledger";
import { diffSheets, type SheetDiff } from "./diff";
import { interpretWhatIf, type WhatIfInput } from "./interpret";
import { narrateDiff, templateNarration, type Narration } from "./narrate";
import type { Interpretation } from "./schemas";

export interface RunWhatIfDeps {
  client: ModelClient;
  emit?: Emit;
  /** Ask the model to phrase the explanation. Default true; false returns the template (no second model call). */
  narrate?: boolean;
}

/** Everything the interface needs to redraw after one What-if message. */
export interface WhatIfRun {
  interpretation: Interpretation;
  before: FactSheet;
  after: FactSheet;
  diff: SheetDiff;
  narration: Narration;
}

/**
 * Run one What-if turn.
 *
 * @throws WhatIfInputError for an empty or over-long message
 * @throws ModelParseError if the interpreter's output is invalid even after repair
 */
export async function runWhatIf(deps: RunWhatIfDeps, input: WhatIfInput): Promise<WhatIfRun> {
  const emit = deps.emit ?? noEmit;
  const interpretation = await interpretWhatIf({ client: deps.client, emit }, input);

  const ledger = new EvidenceLedger();
  const engineInput = { profile: input.profile, goal: input.goal };
  const before = gatherEvidence(ledger, { ...engineInput, constraints: input.current });
  const after = gatherEvidence(ledger, { ...engineInput, constraints: interpretation.next });
  const diff = diffSheets(before, after);

  const narration =
    deps.narrate === false || diff.facts.length === 0
      ? templateNarration(diff)
      : await narrateDiff({ client: deps.client, emit }, interpretation.applied, diff);
  return { interpretation, before, after, diff, narration };
}

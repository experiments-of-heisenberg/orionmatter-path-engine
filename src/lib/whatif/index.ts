/** Public entry point of the What-if module. */
export { applyChanges, MAX_SKILLS, MONTHS_RANGE, normalizeSkill, phraseInText } from "./apply";
export type { ApplyResult } from "./apply";
export { evidenceConflicts } from "./conflicts";
export { interpretWhatIf, MAX_MESSAGE_CHARS, WhatIfInputError } from "./interpret";
export type { InterpretDeps, WhatIfInput } from "./interpret";
export { INTERPRET_SYSTEM_PROMPT, interpretUserMessage } from "./prompts";
export type { ClarificationTurn } from "./prompts";
export { ChangeField, Clarification, Contradiction, ModelChange, ModelOutput, Unsupported } from "./schemas";
export type { AppliedChange, Conflict, Interpretation, RefusedChange } from "./schemas";
export { diffSheets, MONTHS_SHIFT_MIN, OUTSIDE_LIMITS_MIN, RATE_SHIFT_MIN } from "./diff";
export type { Fact, FactKind, RouteDiff, SheetDiff } from "./diff";
export {
  narrateDiff,
  NarrationOutput,
  NARRATE_SYSTEM_PROMPT,
  narrateUserMessage,
  templateNarration,
  verifyNarration,
} from "./narrate";
export type { Narration, NarrateDeps } from "./narrate";
export { runWhatIf } from "./run";
export type { RunWhatIfDeps, WhatIfRun } from "./run";

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

/**
 * Public entry point for the deterministic tools.
 *
 * Tools are pure functions over the synthetic cohort. Agents never call them
 * directly: they go through the EvidenceLedger so every result carries a citable id.
 */
export { findTwins } from "./findTwins";
export { pathStats } from "./pathStats";
export { levelMap } from "./levelMap";
export { compBands } from "./compBands";
export { kAnonymity } from "./kAnonymity";
export { EvidenceLedger } from "./ledger";
export type { AnyEvidence, Evidence, ToolResults, UntrustedCallResult } from "./ledger";
export { ToolArgSchemas, TOOL_NAMES, isToolName } from "./toolSchemas";
export type { ToolArgs, ToolName } from "./toolSchemas";

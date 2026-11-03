/**
 * Public entry point of the model layer.
 *
 * Agents import from here and depend only on the `ModelClient` interface.
 */
export { createModelClient } from "./client";
export type { ModelClientDeps, ModelClientOptions } from "./client";
export * from "./errors";
export { FileFixtureStore, MemoryFixtureStore, fixtureKey, stableStringify } from "./fixtures";
export type { FixtureMode, FixtureStore } from "./fixtures";
export { extractJson, JsonExtractError } from "./json";
export { createMockClient, callTools, reply } from "./mock";
export type { MockModelClient, MockReply, MockStep } from "./mock";
export { chatStructured } from "./structured";
export type { StructuredOptions, StructuredResult } from "./structured";
export { toolDefinition } from "./toolDefs";
export { runToolLoop } from "./toolLoop";
export type { ToolExecutor, ToolLoopEvent, ToolLoopOptions, ToolLoopResult } from "./toolLoop";
export type * from "./types";

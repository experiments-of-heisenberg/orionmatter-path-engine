/**
 * toolSchemas.ts: the single source of truth for what each deterministic tool accepts.
 *
 * Why Zod here: tool calls will come from an LLM, which means the arguments are
 * untrusted JSON. Every tool therefore has a runtime schema; the TypeScript argument
 * types are derived from these schemas so the two can never drift apart.
 */
import { z } from "zod";
import { Archetype, Constraints, Goal, Profile } from "../schemas";

/** Runtime argument schema for each tool, keyed by tool name. */
export const ToolArgSchemas = {
  findTwins: z.object({
    profile: Profile,
    goal: Goal,
    constraints: Constraints.partial().optional(),
  }),
  pathStats: z.object({
    // Cap the list so a misbehaving model cannot send an enormous payload.
    twinIds: z.array(z.string().max(32)).max(2000),
    archetype: Archetype,
  }),
  levelMap: z.object({
    company: z.string().max(80),
    title: z.string().max(80),
  }),
  compBands: z.object({
    level: z.string().max(10),
    region: z.string().max(40),
  }),
} as const;

/** Names of all available tools. */
export type ToolName = keyof typeof ToolArgSchemas;

/** Validated argument type for a given tool. */
export type ToolArgs<N extends ToolName> = z.infer<(typeof ToolArgSchemas)[N]>;

/** Runtime list of tool names, used to reject unknown tool names from the model. */
export const TOOL_NAMES = Object.keys(ToolArgSchemas) as ToolName[];

/** Type guard: is this string the name of a known tool? */
export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as string[]).includes(name);
}

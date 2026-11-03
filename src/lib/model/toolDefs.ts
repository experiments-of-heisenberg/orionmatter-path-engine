/**
 * toolDefs.ts: build model-facing tool definitions from Zod schemas.
 *
 * The same Zod schema both validates a tool's arguments at runtime and, converted to JSON
 * Schema here, tells the model what arguments the tool takes. One definition, so the
 * description the model sees can never disagree with what the code accepts.
 */
import { z } from "zod";
import type { ToolDefinition } from "./types";

/**
 * @param name        tool name the model will call
 * @param description what the tool does and when to use it (this is the model's only guidance)
 * @param schema      Zod object schema for the tool's arguments
 */
export function toolDefinition(name: string, description: string, schema: z.ZodObject): ToolDefinition {
  // Strip the $schema marker: some providers reject unknown keywords in tool parameters.
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { name, description, parameters };
}

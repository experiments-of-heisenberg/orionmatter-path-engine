/**
 * structured.ts: get validated, typed data back from a model.
 *
 * Contract: the caller supplies a Zod schema and gets either data that satisfies it or a
 * ModelParseError. If the first reply fails validation, we show the model its own output
 * and the exact validation errors and ask once for a corrected version (one repair
 * retry, as specified in the architecture). This works on both models whether or not
 * the provider offers a JSON mode.
 */
import { z } from "zod";
import { ModelParseError } from "./errors";
import { parseModelJson } from "./json";
import type { ChatMessage, ChatRequest, ChatResult, ModelClient } from "./types";

export interface StructuredResult<T> {
  data: T;
  /** True when the first reply was invalid and the repair retry fixed it. */
  repaired: boolean;
  /** True when the reply that produced `data` had a short stray tail dropped to make it parseable. */
  recovered: boolean;
  /** Why the first reply was rejected (validation messages), present only when `repaired`. Contains no model text. */
  repairReason?: string;
  /** Result of the call that produced `data`. */
  result: ChatResult;
  /** Sum of token usage across the first call and the repair retry, if any. */
  totalTokens: number;
}

export interface StructuredOptions {
  /** Append the schema to the prompt as a JSON Schema. Default true. */
  includeSchemaInPrompt?: boolean;
}

/** Instruction appended to the conversation so the model knows the exact output shape. */
function schemaInstruction(schema: z.ZodType): ChatMessage {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  return {
    role: "system",
    content:
      "Respond with ONLY a single JSON value that matches this JSON Schema. " +
      `No prose, no markdown fences.\n${jsonSchema}`,
  };
}

/** Try to turn a reply into validated data, describing any problem in plain text. */
function validate<T>(
  result: ChatResult,
  schema: z.ZodType<T>,
): { ok: true; data: T; recovered: boolean } | { ok: false; issues: string } {
  let parsed;
  try {
    // A reply cut off by the token limit is likely missing data: never paper over that.
    parsed = parseModelJson(result.text, { recover: result.finishReason !== "length" });
  } catch (error) {
    return { ok: false, issues: error instanceof Error ? error.message : "could not parse JSON" };
  }
  const checked = schema.safeParse(parsed.value);
  return checked.success
    ? { ok: true, data: checked.data, recovered: parsed.recovered }
    : { ok: false, issues: z.prettifyError(checked.error) };
}

/**
 * Ask the model for JSON and validate it against a schema, with one repair retry.
 *
 * @param client  model client
 * @param request the request; its messages should describe the task
 * @param schema  Zod schema the reply must satisfy
 * @throws ModelParseError when the reply is still invalid after the repair retry
 */
export async function chatStructured<T>(
  client: ModelClient,
  request: ChatRequest,
  schema: z.ZodType<T>,
  options: StructuredOptions = {},
): Promise<StructuredResult<T>> {
  const { includeSchemaInPrompt = true } = options;
  const messages: ChatMessage[] = includeSchemaInPrompt
    ? [...request.messages, schemaInstruction(schema)]
    : [...request.messages];

  const first = await client.chat({ ...request, messages });
  const firstCheck = validate(first, schema);
  if (firstCheck.ok) {
    return {
      data: firstCheck.data,
      repaired: false,
      recovered: firstCheck.recovered,
      result: first,
      totalTokens: first.usage.completionTokens,
    };
  }

  // One repair retry: show the model its output and exactly what was wrong.
  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first.text },
    {
      role: "user",
      content: `Your JSON failed validation:\n${firstCheck.issues}\nReturn corrected JSON only.`,
    },
  ];
  const second = await client.chat({
    ...request,
    label: `${request.label}:repair`,
    messages: repairMessages,
  });
  const secondCheck = validate(second, schema);
  if (secondCheck.ok) {
    return {
      data: secondCheck.data,
      repaired: true,
      recovered: secondCheck.recovered,
      repairReason: firstCheck.issues,
      result: second,
      totalTokens: first.usage.completionTokens + second.usage.completionTokens,
    };
  }
  throw new ModelParseError(request.label, secondCheck.issues, second.text);
}

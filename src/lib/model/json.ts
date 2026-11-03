/**
 * json.ts: pull a JSON value out of a model reply.
 *
 * Models often wrap JSON in markdown fences or add a sentence before or after it. Rather
 * than hoping for clean output (Muse Spark Open officially has no JSON mode), we extract
 * the JSON defensively and let Zod decide whether it is acceptable.
 */

/** Thrown when no parseable JSON value can be found in the text. */
export class JsonExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonExtractError";
  }
}

/** Remove a surrounding ```json ... ``` (or ``` ... ```) fence if present. */
function stripFence(text: string): string {
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(text.trim());
  return fenced?.[1]?.trim() ?? text.trim();
}

/**
 * Find the first balanced {...} or [...] in the text and return its source.
 * String-aware: braces inside JSON strings do not count.
 */
function findBalanced(text: string): string | undefined {
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Extract and parse the JSON value in a model reply.
 *
 * Tries, in order: the whole text, the text inside a code fence, then the first balanced
 * object or array embedded in prose.
 *
 * @returns the parsed value (unvalidated: pass it through a Zod schema)
 * @throws JsonExtractError when nothing parseable is found
 */
export function extractJson(text: string): unknown {
  const candidates = [text.trim(), stripFence(text)];
  const embedded = findBalanced(stripFence(text));
  if (embedded) candidates.push(embedded);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next strategy
    }
  }
  throw new JsonExtractError("no valid JSON object or array found in the model reply");
}

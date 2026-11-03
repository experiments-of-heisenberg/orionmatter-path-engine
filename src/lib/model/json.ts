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
 * A short, safe description of why JSON.parse failed: the reason and character position only.
 *
 * V8's own message can embed a snippet of the input text, which would put model output (and
 * possibly user data) into error messages and repair prompts. We keep just the reason and
 * the position, which is exactly what a model needs to fix its own syntax slip.
 */
function describeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const position = /position (\d+)/.exec(message)?.[1];
  const reason = message.split(/, "|\sin JSON|\sis not valid JSON/)[0]?.trim() || "invalid JSON";
  return position ? `${reason} at character ${position}` : reason;
}

/** Most characters of trailing junk we will drop when recovering. Longer tails are not "stray tokens". */
const MAX_DROPPED_CHARS = 40;
/** Most missing closing brackets we will supply. More suggests real truncation, not a slip. */
const MAX_ADDED_CLOSERS = 3;
/** Characters that would mean the dropped tail still contains JSON content (a key, a string, a new value). */
const CONTENT_CHARS = /["':{[]/;

/**
 * Recover a JSON value from a reply that is complete except for a short stray tail.
 *
 * Seen in live runs: the model writes a whole, correct document, then emits a junk token
 * and leaves a bracket unclosed (for example `...}]} %}`). We find the last point where a
 * value was complete, add the missing closing brackets, and parse that.
 *
 * Deliberately conservative, because wrongly "completing" a reply that was truly cut off
 * mid-content would hide missing data. We only recover when the dropped tail is short,
 * contains no quotes, colons or opening brackets, and at most three brackets are added. The
 * result still goes through schema validation, which rejects anything materially incomplete.
 *
 * @returns the value and how many characters were dropped, or undefined if recovery is unsafe
 */
function recoverStrayTail(text: string): { value: unknown; dropped: number } | undefined {
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;

  // Walk the text, noting every point where a container closed along with what is still open.
  const open: string[] = []; // expected closing bracket for each open container
  const checkpoints: { end: number; closers: string }[] = [];
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
    else if (char === "{") open.push("}");
    else if (char === "[") open.push("]");
    else if (char === "}" || char === "]") {
      if (open.pop() !== char) break; // mismatched bracket: everything after is junk
      checkpoints.push({ end: i + 1, closers: [...open].reverse().join("") });
      if (open.length === 0) break;
    }
  }

  // Try the latest checkpoints first; the first one that parses and passes the safety rules wins.
  for (const checkpoint of checkpoints.slice(-20).reverse()) {
    const tail = text.slice(checkpoint.end).trim();
    if (tail.length > MAX_DROPPED_CHARS || CONTENT_CHARS.test(tail)) continue;
    if (checkpoint.closers.length > MAX_ADDED_CLOSERS) continue;
    try {
      return {
        value: JSON.parse(text.slice(start, checkpoint.end) + checkpoint.closers),
        dropped: tail.length,
      };
    } catch {
      // not valid at this checkpoint; try an earlier one
    }
  }
  return undefined;
}

/** A parsed value plus how it was obtained. */
export interface ParsedJson {
  value: unknown;
  /** True when a short stray tail was dropped and brackets were added to make the JSON valid. */
  recovered: boolean;
  /** Characters of stray tail dropped (0 unless recovered). */
  droppedChars: number;
}

export interface ParseOptions {
  /**
   * Allow recovery from a short stray tail. Pass false when the provider reported the reply
   * was cut off (finish_reason "length"): then missing data is likely and must not be papered over.
   */
  recover?: boolean;
}

/**
 * Parse the JSON value in a model reply, reporting whether recovery was needed.
 *
 * Tries, in order: the whole text, the text inside a code fence, the first balanced object
 * or array embedded in prose, and finally a conservative recovery from a stray tail.
 *
 * @throws JsonExtractError when nothing parseable is found. When the reply contains a
 *         JSON-looking block that fails to parse, the message says why and where.
 */
export function parseModelJson(text: string, options: ParseOptions = {}): ParsedJson {
  const { recover = true } = options;
  const candidates = [text.trim(), stripFence(text)];
  const embedded = findBalanced(stripFence(text));
  if (embedded) candidates.push(embedded);

  let detail: string | undefined;
  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate), recovered: false, droppedChars: 0 };
    } catch (error) {
      // Remember the failure of the most JSON-like candidate to explain it if all fail.
      if (candidate.startsWith("{") || candidate.startsWith("[")) detail = describeParseError(error);
    }
  }

  const recovered = recover ? recoverStrayTail(stripFence(text)) : undefined;
  if (recovered) return { value: recovered.value, recovered: true, droppedChars: recovered.dropped };

  throw new JsonExtractError(
    detail
      ? `the reply looks like JSON but is not valid: ${detail}`
      : "no valid JSON object or array found in the model reply",
  );
}

/**
 * Extract and parse the JSON value in a model reply. See {@link parseModelJson}, which also
 * reports whether recovery was used.
 *
 * @returns the parsed value (unvalidated: pass it through a Zod schema)
 */
export function extractJson(text: string, options: ParseOptions = {}): unknown {
  return parseModelJson(text, options).value;
}

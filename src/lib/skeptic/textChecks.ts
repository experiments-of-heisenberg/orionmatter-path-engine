/**
 * textChecks.ts: pure helpers for checking the words a model wrote.
 *
 * The verifier uses these to answer two questions code CAN answer about prose:
 *   - does it promise or overclaim?
 *   - does every number in it appear in the evidence it cites?
 * Nothing here is clever on purpose: simple, predictable checks produce rejections a
 * person can understand and a model can fix.
 */

/**
 * Words that turn a statistic into a promise. The product never promises outcomes
 * ("twins who reached it typically took...", not "you will reach it").
 *
 * Boundaries are custom rather than `\\b` because `\\b` treats a hyphen as a word edge, which
 * would flag harmless compounds like "will-power", "always-on" or "never-ending".
 */
const OVERCLAIM_PATTERN =
  /(?<![A-Za-z-])(will|guarantee|guarantees|guaranteed|guaranteeing|certain|certainly|definitely|always|never|ensure|ensures|ensuring|proven|surefire|promise|promises|promised)(?![A-Za-z-])/i;

/** Return the first promise-like word in the text, or undefined when there is none. */
export function findOverclaim(text: string): string | undefined {
  return OVERCLAIM_PATTERN.exec(text)?.[1]?.toLowerCase();
}

/**
 * A number token: digits with optional thousands separators and an optional decimal part.
 * It must start at a token boundary and END at one (not followed by a letter, digit, a further
 * decimal, or a further thousands group), so "6pm", "1st" and "65x" are not read as numbers and
 * the engine cannot backtrack to a partial match such as the "6" in "65x" or the "1" in "1,000x".
 */
const NUMBER_TOKEN =
  /(?<![A-Za-z0-9_.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![A-Za-z0-9]|\.\d|,\d{3})/g;

/**
 * Numbers in a piece of prose, as written. Digits glued to letters (band labels like "B4",
 * levels like "L6", ids like "ev_12", ordinals like "1st", times like "6pm") are not
 * numbers, so they are skipped. Thousands separators are understood: "1,000" is 1000.
 *
 * Examples: "n=65" gives [65]; "56% to 78%" gives [56, 78]; "B4-B5 at L6" gives [].
 */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const value = Number((match[1] ?? "").replaceAll(",", ""));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/** Round to two decimals so 0.56 * 100 style arithmetic compares cleanly. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Every number that evidence supports, including the percentage form of fractions.
 * A success-rate interval of [0.56, 0.78] supports writing "56" and "78" (and 0.56, 0.78).
 *
 * @param values numeric leaves taken from the cited evidence results
 */
export function supportedNumbers(values: readonly number[]): Set<number> {
  const supported = new Set<number>();
  for (const value of values) {
    supported.add(round2(value));
    if (value > 0 && value < 1) supported.add(round2(value * 100));
  }
  return supported;
}

/**
 * Collect every finite number inside an arbitrary JSON-like value (objects, arrays, numbers).
 * Used to gather the numeric content of a tool result.
 */
export function numericLeaves(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numericLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(numericLeaves);
  return [];
}

/** Numbers in `text` that are not supported by the given set. Empty when the text is grounded. */
export function ungroundedNumbers(text: string, supported: ReadonlySet<number>): number[] {
  return numbersIn(text).filter((value) => !supported.has(round2(value)));
}

/** True when the text says the evidence is limited (case-insensitive). */
export function mentionsLimitedEvidence(text: string): boolean {
  return /limited evidence/i.test(text);
}

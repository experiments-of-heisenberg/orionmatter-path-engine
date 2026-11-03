/**
 * stable.ts: deterministic JSON serialisation.
 *
 * Why: we compare and hash structured data (fixture keys, "is this the same tool call?").
 * Plain JSON.stringify depends on key insertion order, so equal objects could serialise
 * differently. Sorting keys makes equal data always produce identical text.
 */

/** JSON.stringify with object keys sorted, so equal data always serialises identically. */
export function stableStringify(value: unknown): string {
  // Array holes and undefined items become null, matching JSON.stringify, so [] and [undefined] differ.
  if (Array.isArray(value))
    return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

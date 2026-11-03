/**
 * check.ts: compare an Interpretation with an Expectation, producing readable failures.
 *
 * Pure and offline, so the matcher itself is unit-tested; the live script only supplies
 * real interpretations.
 */
import { Constraints } from "../../src/lib/schemas";
import type { Interpretation } from "../../src/lib/whatif";
import type { EvalCase, Expectation } from "./cases";

/** Order-insensitive equality for the small values we compare (primitives and string lists). */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const sorted = (list: unknown[]): string => list.map(String).sort().join("|");
    return a.length === b.length && sorted(a) === sorted(b);
  }
  return a === b;
}

/** The starting constraints for a case. */
export function startingConstraints(evalCase: EvalCase): Constraints {
  return Constraints.parse(evalCase.current ?? {});
}

/**
 * Check one interpretation.
 *
 * @returns the reasons it fell short of the expectation (empty when it passes)
 */
export function checkInterpretation(evalCase: EvalCase, result: Interpretation): string[] {
  const failures: string[] = [];
  const expect: Expectation = evalCase.expect;
  const start = startingConstraints(evalCase);

  if (expect.status && result.status !== expect.status)
    failures.push(`status was "${result.status}", expected "${expect.status}"`);

  for (const [key, wanted] of Object.entries(expect.set ?? {})) {
    const actual = (result.next as unknown as Record<string, unknown>)[key];
    const ok = wanted === null ? actual === undefined : same(actual, wanted);
    if (!ok)
      failures.push(
        `${key} was ${JSON.stringify(actual)}, expected ${wanted === null ? "absent" : JSON.stringify(wanted)}`,
      );
  }

  if (expect.unsupported === true && result.unsupported.length === 0)
    failures.push("expected an unsupported item, found none");
  if (expect.unsupported === false && result.unsupported.length > 0)
    failures.push(`unexpected unsupported item: "${result.unsupported[0]?.phrase}"`);

  if (expect.clarifyAbout) {
    if (!result.clarification) failures.push("expected a clarification question, got none");
    else if (!expect.clarifyAbout.includes(result.clarification.about)) {
      failures.push(
        `clarification was about "${result.clarification.about}", expected one of ${expect.clarifyAbout.join(", ")}`,
      );
    }
  }
  if (expect.contradiction === true && !result.conflicts.some((c) => c.kind === "contradiction"))
    failures.push("expected a contradiction, found none");
  if (expect.unchanged === true && JSON.stringify(result.next) !== JSON.stringify(start))
    failures.push("constraints changed but should not have");
  if (expect.refused === true && result.refused.length === 0)
    failures.push("expected a refused change, found none");

  return failures;
}

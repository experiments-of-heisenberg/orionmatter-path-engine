/**
 * conflicts.ts: check new constraints against the EVIDENCE.
 *
 * A constraint can be perfectly well-formed and still leave the person with nothing: "Staff
 * in 6 months" when no comparable engineer ever did it that fast. These checks use the
 * engine's fact sheet for the new constraints and report such cases with numbers. They never
 * block: the person decides. They make sure nobody is surprised by an empty map.
 *
 * Pure and deterministic: no model, instant, so sliders can call it on every change.
 */
import { limitsOf, type FactSheet } from "../engine";
import { BANDS, bandIdx } from "../tools/stats";
import type { Constraints } from "../schemas";
import type { ChangeField, Conflict } from "./schemas";

/** Fields a conflict can name. */
type ConflictField = ChangeField;
import { THIN_N } from "../tools/data";

/** Constraint fields that narrow who counts as a twin, for naming in messages. */
function narrowingFields(constraints: Constraints): ("remote" | "noRelocation")[] {
  const fields: ("remote" | "noRelocation")[] = [];
  if (constraints.remote) fields.push("remote");
  if (constraints.noRelocation) fields.push("noRelocation");
  return fields;
}

/**
 * Find conflicts between constraints and the evidence in a fact sheet.
 *
 * @param sheet       fact sheet computed WITH these constraints
 * @param constraints the constraints that produced it
 */
export function evidenceConflicts(sheet: FactSheet, constraints: Constraints): Conflict[] {
  const conflicts: Conflict[] = [];

  // 1. Too few (or no) comparable engineers for these constraints.
  if (sheet.twins.n === 0) {
    conflicts.push({
      kind: "infeasible",
      fields: narrowingFields(constraints),
      message:
        "No comparable engineers match these constraints, so there is no evidence for any route. Try relaxing one.",
    });
  } else if (sheet.twins.n < THIN_N) {
    conflicts.push({
      kind: "thin_evidence",
      fields: narrowingFields(constraints),
      message: `Only ${sheet.twins.n} comparable engineers match these constraints, so every route rests on limited evidence.`,
    });
  }

  // 2. Comparable engineers exist, but none of them reached the goal at all.
  const nobodyReached = sheet.routes.every((route) => route.stats.ignoringLimits.reachedShare === 0);
  if (sheet.twins.n > 0 && nobodyReached) {
    conflicts.push({
      kind: "infeasible",
      fields: narrowingFields(constraints),
      message: `None of the ${sheet.twins.n} comparable engineers reached this goal, so no route has any timeline evidence.`,
    });
  }

  // 3. Some reached the goal, but nobody did it WITHIN the person's own limits.
  const limits = limitsOf(constraints);
  const limited = Object.keys(limits).length > 0;
  const noneWithinLimits = sheet.routes.every((route) => route.stats.reachedN === 0);
  if (sheet.twins.n > 0 && limited && !nobodyReached && noneWithinLimits) {
    const reachedShares = sheet.routes.map((route) => route.stats.ignoringLimits.reachedShare);
    const fastest = Math.min(
      ...sheet.routes.flatMap((route) =>
        route.stats.ignoringLimits.fastestMonths === null ? [] : [route.stats.ignoringLimits.fastestMonths],
      ),
    );
    const bands = sheet.routes.flatMap((route) => {
      const index = bandIdx(route.stats.ignoringLimits.highestBand ?? "");
      return index >= 0 ? [index] : [];
    });
    const asked = [
      limits.maxMonths !== undefined ? `within ${limits.maxMonths} months` : undefined,
      limits.minCompBand !== undefined ? `at pay band ${limits.minCompBand} or above` : undefined,
    ].filter((part): part is string => part !== undefined);
    const fields: ConflictField[] = [];
    if (limits.maxMonths !== undefined) fields.push("maxMonths");
    if (limits.minCompBand !== undefined) fields.push("minCompBand");
    conflicts.push({
      kind: "infeasible",
      fields,
      message:
        `None of the comparable engineers reached this goal ${asked.join(" and ")}. ` +
        `Without those limits up to ${Math.round(Math.max(...reachedShares) * 100)}% on a route reached it; ` +
        `the fastest took ${fastest} months` +
        (bands.length > 0 ? ` and the highest pay band any reached was ${BANDS[Math.max(...bands)]}.` : "."),
    });
  }

  return conflicts;
}

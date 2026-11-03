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
import type { FactSheet } from "../engine";
import { BANDS, bandIdx } from "../tools/stats";
import type { Constraints } from "../schemas";
import type { Conflict } from "./schemas";
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

  // 1b. Comparable engineers exist, but none of them reached the goal: no route has a timeline.
  if (sheet.twins.n > 0 && sheet.routes.every((route) => route.monthsToGoal === null)) {
    conflicts.push({
      kind: "infeasible",
      fields: narrowingFields(constraints),
      message: `None of the ${sheet.twins.n} comparable engineers reached this goal, so no route has any timeline evidence.`,
    });
  }

  // 2. A time limit shorter than anyone's typical timeline.
  if (constraints.maxMonths !== undefined) {
    const timed = sheet.routes.flatMap((route) =>
      route.monthsToGoal ? [{ route, months: route.monthsToGoal }] : [],
    );
    const fastest = timed.reduce<(typeof timed)[number] | undefined>(
      (best, item) => (best === undefined || item.months[0] < best.months[0] ? item : best),
      undefined,
    );
    if (fastest && constraints.maxMonths < fastest.months[0]) {
      conflicts.push({
        kind: "infeasible",
        fields: ["maxMonths"],
        message:
          `No route's typical timeline fits within ${constraints.maxMonths} months. The fastest comparable engineers ` +
          `(the ${fastest.route.archetype} route) took ${fastest.months[0]} to ${fastest.months[1]} months.`,
      });
    }
  }

  // 3. A pay floor above every route's comp range.
  if (constraints.minCompBand !== undefined) {
    const wanted = bandIdx(constraints.minCompBand);
    const reachable = sheet.routes
      .map((route) => bandIdx(route.compBandRange[1]))
      .filter((index) => index >= 0);
    const highest = reachable.length > 0 ? Math.max(...reachable) : -1;
    if (highest >= 0 && wanted > highest) {
      conflicts.push({
        kind: "infeasible",
        fields: ["minCompBand"],
        message: `No route's comp range reaches ${constraints.minCompBand}. The highest any comparable route reached is ${BANDS[highest]}.`,
      });
    }
  }

  return conflicts;
}

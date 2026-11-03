/** Helpers for UI tests: real explore data for a person, so the drawings are tested against real numbers. */
import { handleExplore, type ExploreResult } from "../../src/lib/api/handlers";
import { PlanRequest } from "../../src/lib/api/schemas";
import { SAMPLE_PERSON, type Person } from "../../src/ui/sample";

/** The explore result for a person with optional constraint overrides. */
export function exploreFor(
  constraints: object = {},
  person: Person = SAMPLE_PERSON,
): { person: Person; data: ExploreResult } {
  const merged: Person = { ...person, constraints: { ...person.constraints, ...constraints } };
  return { person: merged, data: handleExplore(PlanRequest.parse(merged)) };
}

/** The same sample person as an embedded engineer: thin evidence on several routes. */
export function embeddedPerson(): Person {
  return { ...SAMPLE_PERSON, profile: { ...SAMPLE_PERSON.profile, roleFamily: "embedded" } };
}

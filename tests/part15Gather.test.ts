/** The Planner is told the person's limits, so two people with different limits never share a request. */
import { describe, expect, it } from "vitest";
import { gatherUserMessage } from "../src/lib/agents/plannerPrompts";
import { Constraints } from "../src/lib/schemas";
import { fixtureKey } from "../src/lib/model";
import { goal, input, profile } from "./helpers/fixturesData";

const message = (constraints: object) =>
  gatherUserMessage({ ...input, constraints: Constraints.parse(constraints) });

describe("gatherUserMessage", () => {
  it("states the goal, the region and the limits, with the limits marked as data", () => {
    const text = message({ maxMonths: 24, noRelocation: true });
    expect(text).toContain(`"${goal.label}"`);
    expect(text).toContain(profile.region);
    expect(text).toContain('<constraints>{"noRelocation":true,"maxMonths":24');
    expect(text).toContain("already applied to every lookup");
  });
  it("differs when the limits differ and is identical when they do not, so a recorded answer cannot be shared by two people", () => {
    expect(message({})).not.toBe(message({ maxMonths: 24 }));
    expect(message({ maxMonths: 24 })).toBe(message({ maxMonths: 24 }));
    const key = (constraints: object) =>
      fixtureKey(
        {
          label: "g",
          target: "spark",
          messages: [{ role: "user", content: message(constraints) }],
        },
        "m",
      );
    expect(key({})).not.toBe(key({ remote: true }));
  });
});

/** Helpers for privacy tests: a real assessment from the real handler with a scripted model. */
import { handlePrivacy } from "../../src/lib/api/handlers";
import { PrivacyRequest } from "../../src/lib/api/schemas";
import type { Services } from "../../src/lib/api/services";
import type { PrivacyAssessment } from "../../src/lib/privacy";
import { createMockClient, reply, type MockStep } from "../../src/lib/model";
import { SAMPLE_PERSON, type Person } from "../../src/ui/sample";

export const STORY =
  "I worked at Acme Robotics on the Orion arm project. Mail me at jo@example.com. I earned 4200000 rupees in 2023.";

/** The model's findings for STORY: one real quote and one the text does not contain (the guard must drop it). */
export const modelFindings = reply(
  JSON.stringify({
    findings: [
      { quote: "Acme Robotics", category: "employer", reason: "a named company" },
      { quote: "Orion arm project", category: "project_or_product", reason: "a named project" },
      { quote: "Nobel prize", category: "unique_achievement", reason: "not in the text at all" },
    ],
  }),
);

/** Assess a person (and optionally a story) through the real handler. */
export function assessed(
  body: { k?: number; companyType?: string; text?: string; useModel?: boolean } = {},
  steps: MockStep[] = [],
  person: Person = SAMPLE_PERSON,
): Promise<PrivacyAssessment> {
  const request = PrivacyRequest.parse({ profile: person.profile, goal: person.goal, ...body });
  return handlePrivacy({ client: createMockClient(steps) } as unknown as Services, request, () => undefined);
}

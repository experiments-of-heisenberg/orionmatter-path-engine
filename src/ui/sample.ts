/** sample.ts: the person the app opens with until Intake has read someone's real words. */
import type { Constraints, Goal, Profile } from "../lib/schemas";

export interface Person {
  profile: Profile;
  goal: Goal;
  constraints: Constraints;
}

/** A backend engineer at L5 in southern India aiming for Staff: the same person every test and doc uses. */
export const SAMPLE_PERSON: Person = {
  profile: {
    roleFamily: "backend",
    level: "L5",
    yearsExperience: 7,
    stack: ["go", "kubernetes"],
    region: "IN-south",
    milestones: [],
  },
  goal: { targetLevel: "L6", label: "Staff Engineer" },
  constraints: { riskTolerance: "medium", addSkills: [] },
};

/** Words for the role families and regions, for the profile chips. */
export const ROLE_LABEL: Readonly<Record<Profile["roleFamily"], string>> = {
  backend: "Backend",
  platform: "Platform",
  ml: "ML",
  frontend: "Frontend",
  embedded: "Embedded",
  sre: "SRE",
};

export const REGION_LABEL: Readonly<Record<string, string>> = {
  "IN-south": "South India",
  "US-east": "US East",
  "US-west": "US West",
  "EU-west": "Western Europe",
  SEA: "South-East Asia",
};

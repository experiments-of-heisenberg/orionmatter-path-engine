/** A standard person and goal for live scripts: a backend L5 in India aiming for Staff. */
import { Goal, Profile } from "../../src/lib/schemas";

export const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go", "kubernetes"],
  region: "IN-south",
});
export const goal = Goal.parse({ targetLevel: "L6", label: "Staff Engineer" });

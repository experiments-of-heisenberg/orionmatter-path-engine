/** Helpers for intake tests: a real intake result from the real handler with a scripted model. */
import { handleIntake } from "../../src/lib/api/handlers";
import { IntakeRequest } from "../../src/lib/api/schemas";
import type { Services } from "../../src/lib/api/services";
import type { IntakeResult } from "../../src/lib/intake";
import { createMockClient, reply, type MockStep } from "../../src/lib/model";

export const STORY_TEXT =
  "I'm L5 backend engineer, 7 years in IN-south, working with Go and Kubernetes. I want to reach L6 Staff Engineer. Reach me at jo@example.com.";

const nothing = {
  roleFamily: null,
  level: null,
  company: null,
  title: null,
  yearsExperience: null,
  region: null,
  compBand: null,
  stack: [],
  milestones: [],
  goal: null,
};

/** A model reading with every field the story states, quoting the story's own words. */
export const fullReading = reply(
  JSON.stringify({
    ...nothing,
    roleFamily: { value: "backend", quote: "backend engineer" },
    level: { value: "L5", quote: "L5 backend" },
    yearsExperience: { value: 7, quote: "7 years" },
    region: { value: "IN-south", quote: "IN-south" },
    stack: ["go", "kubernetes"],
    goal: { targetLevel: "L6", label: "Staff Engineer", quote: "L6 Staff Engineer" },
  }),
);

/** A reading that finds the role and level only, so the region and years are still missing. */
export const partialReading = reply(
  JSON.stringify({
    ...nothing,
    roleFamily: { value: "backend", quote: "backend engineer" },
    level: { value: "L5", quote: "L5 backend" },
  }),
);

/** A reading that finds only the years of experience (the answer to "how many years?"). */
export const yearsReading = reply(
  JSON.stringify({ ...nothing, yearsExperience: { value: 7, quote: "7 years" } }),
);

/** A reading that finds nothing at all. */
export const emptyReading = reply(JSON.stringify(nothing));

/** Read a story through the real handler. */
export function read(body: { text?: string; previous?: unknown }, steps: MockStep[]): Promise<IntakeResult> {
  const request = IntakeRequest.parse(body);
  return handleIntake({ client: createMockClient(steps) } as unknown as Services, request, () => undefined);
}

/** A tiny valid PNG of a given size (the header is all the server checks; the body is a stub). */
export function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return Uint8Array.from(bytes);
}

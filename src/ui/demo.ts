/**
 * demo.ts: the example inputs a person can try with one click.
 *
 * They exist for two reasons. A first-time visitor should not have to invent a career story to see the product, and the
 * same exact texts are the ones recorded for the offline demo (see scripts/record-demo-fixtures.ts), so a build that replays
 * recorded Muse Spark answers can run every example without a key. Change a text here and the recording must be redone:
 * a test fails until it is.
 */

/** A career story that Your story reads into the same person the app opens on. */
export const DEMO_STORY =
  "I'm a senior backend engineer (L5) with 7 years of experience, based in IN-south. I work mostly with Go and Kubernetes. I'd like to become a Staff Engineer (L6).";

/** Something a person might post about themselves, with a company, a project, a contact detail and a pay figure in it. */
export const DEMO_BIO =
  "I'm a backend engineer at Acme Robotics, working on the Orion arm project. I joined in March 2023 and I earn 4200000 rupees. Reach me at jo@example.com.";

/** Sentences to try in What if, shown while the conversation is empty. The typographic apostrophe is for display only. */
export const WHATIF_EXAMPLES = [
  "What if I won\u2019t relocate?",
  "I need pay band B4 or higher",
  "What if I want to get there within 2 years?",
  "What if I learn Rust?",
] as const;

/** What is actually sent for an example: a plain apostrophe, so the recorded answer matches the request. */
export function exampleMessage(example: string): string {
  return example.replace(/[\u2019]/g, "'");
}

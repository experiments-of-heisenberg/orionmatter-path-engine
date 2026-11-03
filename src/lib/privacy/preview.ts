/**
 * preview.ts: the text with every finding replaced by a placeholder for its category.
 *
 * The placeholders are fixed strings written here, never the model's words, so the preview cannot
 * carry anything a model made up. Matching is by whole words and ignores case and spacing, like the
 * quote guard that admitted the finding in the first place.
 */
import type { FindingCategory, PrivacyFinding } from "./schemas";

/** Placeholder for each category. */
export const PLACEHOLDERS: Readonly<Record<FindingCategory, string>> = {
  contact_detail: "[contact detail removed]",
  exact_date: "[a date]",
  exact_compensation: "[a pay figure]",
  person_name: "[a person]",
  employer: "[a company]",
  project_or_product: "[a project]",
  school: "[a school]",
  location_detail: "[a place]",
  small_team_detail: "[a team detail]",
  unique_achievement: "[an achievement]",
  other: "[a detail]",
};

const escapeToken = (token: string): string => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex that finds `phrase` as whole words, ignoring case and treating any run of spaces alike. */
export function phraseRegex(phrase: string): RegExp {
  const body = phrase.trim().split(/\s+/).map(escapeToken).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * Replace every finding in the text.
 *
 * @returns the generalised text; longer quotes are replaced first so "Acme Robotics" wins over "Acme"
 */
export function generalise(text: string, findings: readonly PrivacyFinding[]): string {
  let out = text;
  const ordered = [...findings].sort((a, b) => b.quote.length - a.quote.length);
  for (const finding of ordered) {
    if (finding.quote.trim().length === 0) continue;
    out = out.replace(phraseRegex(finding.quote), PLACEHOLDERS[finding.category]);
  }
  return out;
}

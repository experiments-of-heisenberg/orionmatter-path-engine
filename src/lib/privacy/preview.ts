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
 * All matches are found on the ORIGINAL text in one pass and then spliced in, so a placeholder
 * inserted for one finding can never be matched, split or corrupted by another ("Acme Corporation"
 * then "company" must not produce "[a [a detail]]"). Longer quotes claim their words first, so
 * "Acme Robotics" wins over "Acme"; a match that overlaps one already claimed is skipped.
 */
export function generalise(text: string, findings: readonly PrivacyFinding[]): string {
  const claimed: { start: number; end: number; placeholder: string }[] = [];
  const overlaps = (start: number, end: number): boolean =>
    claimed.some((c) => start < c.end && c.start < end);
  const ordered = [...findings].sort((a, b) => b.quote.length - a.quote.length);
  for (const finding of ordered) {
    if (finding.quote.trim().length === 0) continue;
    for (const match of text.matchAll(phraseRegex(finding.quote))) {
      const start = match.index;
      const end = start + match[0].length;
      if (!overlaps(start, end)) claimed.push({ start, end, placeholder: PLACEHOLDERS[finding.category] });
    }
  }
  claimed.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const c of claimed) {
    out += text.slice(cursor, c.start) + c.placeholder;
    cursor = c.end;
  }
  return out + text.slice(cursor);
}

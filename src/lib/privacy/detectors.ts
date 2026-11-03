/**
 * detectors.ts: identifying details that code can recognise without a model.
 *
 * Contact details (emails, phone numbers, links), exact dates and exact pay figures follow
 * fixed patterns, so code finds them, always the same way, and never sends them to a model to be
 * judged. Names, employers, project names and the like need a reader: that is the model's half.
 */
import { findPii } from "../intake/redact";
import type { PrivacyFinding } from "./schemas";

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const ISO_DATE = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g;
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?,? (?:19|20)\\d{2}\\b`, "gi");
const DAY_MONTH_YEAR = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? ${MONTH}\\.?,? (?:19|20)\\d{2}\\b`, "gi");
// A currency symbol and an amount ("$180k", "₹45,00,000"), or an amount and a currency or pay unit.
// An amount ends on a digit, so the full stop that ends a sentence stays outside the match.
const PAY_SYMBOL = /[$€£₹]\s?\d(?:[\d,.]*\d)?(?:\s?(?:[kKmM]|lakh|lakhs|crore|crores)\b)?/g;
const PAY_UNIT = /\b\d(?:[\d,.]*\d)?\s?(?:LPA|lpa|USD|EUR|GBP|INR)\b/g;

/** Find every contact detail, exact date and exact pay figure in the text. */
export function detectIdentifiers(text: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const seen = new Set<string>();
  const add = (quote: string, category: PrivacyFinding["category"], reason: string): void => {
    const key = `${category}|${quote.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ quote, category, reason, source: "code" });
  };
  for (const pii of findPii(text)) {
    add(
      pii.text,
      "contact_detail",
      `A ${pii.kind === "link" ? "link" : pii.kind === "email" ? "email address" : "phone number"} points straight at you.`,
    );
  }
  for (const pattern of [ISO_DATE, MONTH_DAY_YEAR, DAY_MONTH_YEAR]) {
    for (const match of text.matchAll(pattern))
      add(match[0], "exact_date", "An exact date can be matched against public records.");
  }
  for (const pattern of [PAY_SYMBOL, PAY_UNIT]) {
    for (const match of text.matchAll(pattern))
      add(
        match[0].trim(),
        "exact_compensation",
        "An exact pay figure is highly identifying; a band is enough for planning.",
      );
  }
  return findings;
}

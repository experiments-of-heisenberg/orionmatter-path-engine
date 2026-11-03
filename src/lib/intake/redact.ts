/**
 * redact.ts: remove obvious personal identifiers from text BEFORE it is sent to a model.
 *
 * Intake reads a pasted resume or bio. A career plan does not need anyone's email address, phone
 * number or profile link, so they are replaced with placeholders locally and the model never sees
 * them. This is a best-effort filter for the common cases, NOT a guarantee: names, employers and
 * free-text details can still identify a person, and the interface says so. (The Privacy Guard,
 * Part 10, is the second layer: it judges what the wider data could reveal.)
 */

/** How many of each kind of identifier were removed. */
export interface Redactions {
  emails: number;
  phones: number;
  links: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// A link ends at a character that can end a URL: trailing sentence punctuation is left in the text.
const LINK =
  /\b(?:https?:\/\/|www\.)[^\s<>"')]*[^\s<>"').,;:!?]|\b(?:linkedin|github|gitlab|twitter|x)\.com\/[^\s<>"')]*[^\s<>"').,;:!?]/gi;
// A phone number: optional +country, then 7 to 14 digits with common separators. Years ("2019-2023") are
// excluded because they contain only two short digit groups and no more than 8 digits in total.
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{6,17}\d(?![\w])/g;

/** True when a digit run looks like a phone number rather than a date range or a year pair. */
function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  // "2019-2023" style: two groups of exactly four digits is a date range, not a phone number.
  return !/^\d{4}\s*[-–]\s*\d{4}$/.test(candidate.trim());
}

/**
 * Replace emails, phone numbers and links with placeholders.
 *
 * @returns the cleaned text and how many of each were removed
 */
export function redactPii(text: string): { text: string; redactions: Redactions } {
  const redactions: Redactions = { emails: 0, phones: 0, links: 0 };
  let out = text.replace(EMAIL, () => {
    redactions.emails++;
    return "[email removed]";
  });
  out = out.replace(LINK, () => {
    redactions.links++;
    return "[link removed]";
  });
  out = out.replace(PHONE, (match) => {
    if (!looksLikePhone(match)) return match;
    redactions.phones++;
    return "[phone removed]";
  });
  return { text: out, redactions };
}

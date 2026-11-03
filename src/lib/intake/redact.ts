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
  /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]]*[^\s<>"'()[\].,;:!?]|\b(?:linkedin|github|gitlab|twitter|x)\.com\/[^\s<>"'()[\]]*[^\s<>"'()[\].,;:!?]/gi;
// A phone number: optional +country, then 7 to 14 digits with common separators. Years ("2019-2023") are
// excluded because they contain only two short digit groups and no more than 8 digits in total.
const PHONE = /(?<![\w.])\(?\+?\d[\d\s().-]{6,17}\d(?![\w])/g;

/** True when a digit run looks like a phone number rather than a date range or a year pair. */
function looksLikePhone(candidate: string): boolean {
  // An IPv4 address ("192.168.1.100") has the digits of a phone number but is not one.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate.trim())) return false;
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
  // Links first: an email-like piece inside a link ("https://x.com/a@b.com") belongs to the link.
  let out = text.replace(LINK, () => {
    redactions.links++;
    return "[link removed]";
  });
  out = out.replace(EMAIL, () => {
    redactions.emails++;
    return "[email removed]";
  });
  out = out.replace(PHONE, (match) => {
    if (!looksLikePhone(match)) return match;
    redactions.phones++;
    return "[phone removed]";
  });
  return { text: out, redactions };
}

/** One personal identifier found in text. */
export interface PiiMatch {
  kind: "email" | "phone" | "link";
  /** The matched text exactly as written. */
  text: string;
}

/**
 * List the identifiers `redactPii` would remove, with their original text. Same patterns and the
 * same order (links, then emails, then phones), so an email inside a link is one link, not two items.
 */
export function findPii(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];
  let work = text.replace(LINK, (match) => {
    found.push({ kind: "link", text: match });
    return " ";
  });
  work = work.replace(EMAIL, (match) => {
    found.push({ kind: "email", text: match });
    return " ";
  });
  work.replace(PHONE, (match) => {
    if (looksLikePhone(match)) found.push({ kind: "phone", text: match.trim() });
    return match;
  });
  return found;
}

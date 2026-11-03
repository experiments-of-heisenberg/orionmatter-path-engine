/** text.ts: small text helpers shared by the controls. */

/**
 * Cut `text` to at most `max` UTF-16 code units (the unit the API's length limits count), without leaving half
 * of an emoji at the end: a lone high surrogate would be an invalid character in what we send.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

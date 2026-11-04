/**
 * limits.ts: numbers shared by the server and the browser.
 *
 * They live in their own file, with no imports, so the browser can use them without downloading the schema library
 * that checks requests on the server. `schemas.ts` re-exports them, so existing imports keep working.
 */

/** Most skills a person can ask about at once. The What-if interpreter enforces the same limit. */
export const MAX_SKILLS = 5;

/**
 * levelMap.ts: translates company-specific job titles to canonical levels.
 *
 * Users describe themselves with their employer's titles; the planner reasons
 * in one canonical ladder (L3-L7, EM1-EM2), so this mapping runs before matching.
 */
import { LEVEL_MAP } from "./data";

/**
 * Maps a company title to its canonical level.
 *
 * @param company employer system name, matched exactly (case-sensitive).
 * @param title job title within that system, matched exactly.
 * @returns the canonical level, or null when the company or the title is unknown.
 */
export function levelMap(company: string, title: string): { canonicalLevel: string | null } {
  const sys = LEVEL_MAP.systems[company];
  return { canonicalLevel: sys?.[title] ?? null };
}

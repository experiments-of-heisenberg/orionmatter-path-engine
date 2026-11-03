import { LEVEL_MAP } from "./data";

export function levelMap(company: string, title: string): { canonicalLevel: string | null } {
  const sys = LEVEL_MAP.systems[company];
  return { canonicalLevel: sys?.[title] ?? null };
}

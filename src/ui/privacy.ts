/**
 * privacy.ts: the Privacy tab as plain data.
 *
 * The disclosure ladder answers one question in numbers: as you share more about yourself (role, then level,
 * then goal, then region), how many comparable engineers in the cohort still match? Below the crowd size k you
 * stand out. This module turns the server's assessment into the rows, sentences and groups the screen draws, checks
 * a story before it is sent, and builds the request. The cohort is synthetic and the screen says so; nothing here is
 * a guarantee about real-world uniqueness.
 */
import type { FindingCategory, LadderRung, PrivacyAssessment, PrivacyFinding } from "../lib/privacy";

/** Longest story the server accepts, in characters. Kept equal to the server's limit by a test. */
export const MAX_STORY = 3000;

/** Crowd sizes offered. 10 is the default the server uses. */
export const K_OPTIONS = [5, 10, 20, 50] as const;
export const DEFAULT_K_UI = 10;

/** Company types in the cohort. Kept equal to the data by a test. */
export const COMPANY_TYPES = [
  "bigtech",
  "growth-infra",
  "robotics",
  "seriesB-fintech",
  "seriesC-fintech",
] as const;

/** One bar of the ladder. */
export interface LadderRow {
  /** What was added at this step: "role", "level", "goal", "region", "company type". */
  added: string;
  /** This step's own detail ("IN-south"), as the server gave it. */
  label: string;
  /** Everything shared up to here. */
  shared: string;
  size: number;
  passes: boolean;
  /** Bar length as a fraction of the first step's crowd (0 to 1). */
  width: number;
  /** One plain sentence with the number in it. */
  sentence: string;
}

/** The ladder as rows, with bars scaled to the largest crowd (the first step). */
export function ladderRows(ladder: readonly LadderRung[]): LadderRow[] {
  const max = Math.max(1, ...ladder.map((r) => r.size));
  return ladder.map((rung) => ({
    added: rung.added,
    label: rung.label,
    shared: rung.shared,
    size: rung.size,
    passes: rung.passes,
    width: rung.size / max,
    sentence: rungSentence(rung),
  }));
}

/** "Sharing backend, L5 leaves 93 comparable engineers who match." One engineer is said plainly: you would be unique here. */
export function rungSentence(rung: LadderRung): string {
  if (rung.size === 0)
    return `Sharing ${rung.shared} matches no one in the cohort, so it would single you out.`;
  if (rung.size === 1)
    return `Sharing ${rung.shared} leaves exactly 1 comparable engineer: you would be unique in this cohort.`;
  return `Sharing ${rung.shared} leaves ${rung.size} comparable engineers who match.`;
}

/** Where the k line sits on the bars, as a fraction of the chart width (clamped to the chart). */
export function kPosition(ladder: readonly LadderRung[], k: number): number {
  const max = Math.max(1, ...ladder.map((r) => r.size));
  return Math.min(1, Math.max(0, k / max));
}

/** Words for each risk level. The icon and the word always travel together. */
export const RISK_WORD: Readonly<Record<PrivacyAssessment["risk"], string>> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

/** A sentence about what is safe to share, from the ladder's own result. */
export function shareSummary(
  a: Pick<PrivacyAssessment, "k" | "fullPasses" | "shareableUpTo" | "dropToReachK">,
): string {
  if (a.fullPasses) return `Sharing all of it still leaves a crowd of at least ${a.k}.`;
  if (a.shareableUpTo === null)
    return `Even your first detail leaves fewer than ${a.k} comparable engineers.`;
  const drop =
    a.dropToReachK.length > 0 ? ` To get back to ${a.k}, leave out: ${a.dropToReachK.join(", ")}.` : "";
  return `You can share up to ${a.shareableUpTo} and stay in a crowd of at least ${a.k}.${drop}`;
}

/** Plain names for the kinds of identifying detail. */
export const CATEGORY_TITLE: Readonly<Record<FindingCategory, string>> = {
  contact_detail: "Contact details",
  exact_date: "Exact dates",
  exact_compensation: "Exact pay",
  person_name: "Names of people",
  employer: "Employers",
  project_or_product: "Projects and products",
  school: "Schools",
  location_detail: "Locations",
  small_team_detail: "Small-team details",
  unique_achievement: "Unusual achievements",
  other: "Other details",
};

/** Findings grouped by kind, in first-seen order. */
export function findingGroups(
  findings: readonly PrivacyFinding[],
): { category: FindingCategory; title: string; items: PrivacyFinding[] }[] {
  const groups = new Map<FindingCategory, PrivacyFinding[]>();
  for (const f of findings) groups.set(f.category, [...(groups.get(f.category) ?? []), f]);
  return [...groups.entries()].map(([category, items]) => ({
    category,
    title: CATEGORY_TITLE[category],
    items,
  }));
}

/** Who found a detail, in words. A model finding is always one code checked against the text. */
export function sourceWords(f: Pick<PrivacyFinding, "source">): string {
  return f.source === "code" ? "Found by code" : "Proposed by Muse Spark, quote checked by code";
}

/** What happened to the text check, in words the person can act on. */
export function textCheckWords(check: PrivacyAssessment["textCheck"]): string {
  switch (check) {
    case "done":
      return "Muse Spark read your text; code kept only details whose quote is really in your words.";
    case "code_only":
      return "Only code checked your text (contact details, exact dates, exact pay). The model was not used.";
    case "skipped":
      return "No text to check.";
  }
}

/** Check a story before it is sent: the cleaned text, or what is wrong. Empty is allowed only as "no text". */
export function checkStory(raw: string): { ok: true; text: string } | { ok: false; message: string } {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (text === "") return { ok: false, message: "Paste or type the text you are thinking of sharing." };
  if (text.length > MAX_STORY)
    return { ok: false, message: `That is ${text.length} characters. Please keep it under ${MAX_STORY}.` };
  return { ok: true, text };
}

/** The settings behind a privacy request. */
export interface PrivacySettings {
  k: number;
  /** A company type to include in the ladder, or undefined. */
  companyType: string | undefined;
}

/** The request body for a privacy call. */
export function privacyBody(
  settings: PrivacySettings,
  text?: { text: string; useModel: boolean },
): { k: number; companyType?: string; text?: string; useModel?: boolean } {
  return {
    k: settings.k,
    ...(settings.companyType ? { companyType: settings.companyType } : {}),
    ...(text ? { text: text.text, useModel: text.useModel } : {}),
  };
}

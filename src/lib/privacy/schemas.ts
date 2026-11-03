/**
 * schemas.ts: the data shapes of the Privacy Guard.
 *
 * The Guard answers one question: "if I share this career story, how easily could someone work out
 * who I am?" It has two halves, and code owns the verdict:
 *   - the DISCLOSURE LADDER: how the crowd of comparable engineers shrinks as each attribute is shared
 *   - the TEXT CHECK: identifying details in the free text, found by code detectors and by Muse Spark,
 *     where every model finding must quote the person's own words
 */
import { z } from "zod";

/** What kind of identifying detail a finding is. */
export const FindingCategory = z.enum([
  "contact_detail",
  "exact_date",
  "exact_compensation",
  "person_name",
  "employer",
  "project_or_product",
  "school",
  "location_detail",
  "small_team_detail",
  "unique_achievement",
  "other",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

/** The categories the model may report. Contact details, exact dates and exact pay are found by code. */
export const ModelCategory = FindingCategory.exclude(["contact_detail"]);

/** What the model returns. */
export const PrivacyModelOutput = z.object({
  findings: z
    .array(
      z.object({
        /** The exact words from the text. */
        quote: z.string().min(2).max(80),
        category: ModelCategory,
        /** One short reason, shown to the person as plain text. */
        reason: z.string().min(1).max(140),
      }),
    )
    .max(20),
});
export type PrivacyModelOutput = z.infer<typeof PrivacyModelOutput>;

/** An identifying detail in the text. */
export interface PrivacyFinding {
  quote: string;
  category: FindingCategory;
  reason: string;
  /** "code" for patterns code recognises, "model" for details Muse Spark proposed and code verified. */
  source: "code" | "model";
}

/** One step of the disclosure ladder: the crowd you would be hiding in if you shared everything up to here. */
export interface LadderRung {
  /** What was added at this step, e.g. "region". */
  added: string;
  /** Everything shared so far, e.g. "backend, L5, goal L6". */
  shared: string;
  /** Comparable engineers in the cohort who match everything shared so far. */
  size: number;
  /** True when the crowd is at least k. */
  passes: boolean;
}

/** The answer. */
export interface PrivacyAssessment {
  /** Decided by code from the ladder and the findings. */
  risk: "low" | "medium" | "high";
  /** Why, in plain language, written by code. */
  reasons: string[];
  k: number;
  ladder: LadderRung[];
  /** True when sharing every attribute still leaves a crowd of at least k. */
  fullPasses: boolean;
  /** The last rung that still passes (what could be shared safely), or null when even the first does not. */
  shareableUpTo: string | null;
  /** Attributes to leave out, in order, to reach a crowd of k (empty when it already is). */
  dropToReachK: string[];
  findings: PrivacyFinding[];
  /** "done": Muse Spark checked the text. "code_only": the model was unavailable or switched off. "skipped": there was no text. */
  textCheck: "done" | "code_only" | "skipped";
  /** The text with every finding replaced by a category placeholder, or null when there was no text. */
  generalisedText: string | null;
  /** Proposed items the code refused, and other observations. */
  notes: string[];
  /** What the numbers are based on. Always present, so it is always shown. */
  basis: string;
}

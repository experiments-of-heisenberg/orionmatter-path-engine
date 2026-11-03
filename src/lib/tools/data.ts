/**
 * data.ts: loads the synthetic cohort and reference tables into memory.
 *
 * All tools read from these shared constants so every number in a plan traces
 * back to the same generated dataset — never to live user data or model output.
 */
import cohortFile from "../../../data/cohort.synthetic.json";
import levelMapFile from "../../../data/level-map.json";
import markersFile from "../../../data/company-markers.json";
import type { CohortRecord } from "../schemas";

/** Synthetic career histories; the only dataset the tools aggregate over. */
export const COHORT = (cohortFile as { records: CohortRecord[] }).records;
/** Canonical ladder plus per-company title mappings (illustrative, not real employer data). */
export const LEVEL_MAP = levelMapFile as {
  levels: string[];
  systems: Record<string, Record<string, string>>;
};
/** A fictional, tiered company marker (illustrative data, not a real employer). */
export interface CompanyMarker {
  id: string;
  name: string;
  /** Typical months spent at each level before promotion. */
  monthsPerLevel: Record<string, number>;
  onCall: "low" | "medium" | "high";
  interview: string;
}
/** Fictional company markers referenced by plan steps via Step.companyMarkerIds. */
export const MARKERS = (markersFile as { markers: CompanyMarker[] }).markers;
/** Sample sizes below this count are flagged `evidenceThin`. */
export const THIN_N = 15;

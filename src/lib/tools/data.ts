import cohortFile from "../../../data/cohort.synthetic.json";
import levelMapFile from "../../../data/level-map.json";
import markersFile from "../../../data/company-markers.json";
import type { CohortRecord } from "../schemas";

export const COHORT = (cohortFile as { records: CohortRecord[] }).records;
export const LEVEL_MAP = levelMapFile as { levels: string[]; systems: Record<string, Record<string, string>> };
export const MARKERS = (markersFile as { markers: { id: string; name: string }[] }).markers;
export const THIN_N = 15;

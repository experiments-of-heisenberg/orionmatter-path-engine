import { COHORT, THIN_N } from "./data";
import { bandIdx, BANDS, percentile } from "./stats";

/** Comp bands (not points) for engineers who reached a given level in a region. */
export function compBands(level: string, region: string) {
  const rows = COHORT.filter(r => r.endLevel === level && r.outcome === "reached" && r.region === region);
  const v = rows.map(r => bandIdx(r.compBandEnd)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p25: null, p50: null, p75: null, evidenceThin: true };
  const b = (p: number) => BANDS[Math.round(percentile(v, p))];
  return { n: v.length, p25: b(0.25), p50: b(0.5), p75: b(0.75), evidenceThin: v.length < THIN_N };
}

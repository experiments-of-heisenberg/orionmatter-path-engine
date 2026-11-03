/**
 * compBands.ts: reports what comparable engineers earn as a band range.
 *
 * Pay is sensitive and noisy, so this tool returns ordered bands (B1 lowest to
 * B5 highest) as a P25-P75 range over engineers who reached the level — never
 * individual figures or a single point estimate.
 */
import { COHORT, THIN_N } from "./data";
import { bandAt, bandIdx, percentile } from "./stats";

/**
 * Compensation band range for engineers who reached a level in a region.
 *
 * Only cohort records that reached `level` in `region` are counted.
 *
 * @param level canonical end level, e.g. "L6".
 * @param region cohort region, e.g. "US-west"; must match exactly.
 * @returns sample size `n`, the P25/P50/P75 bands, and `evidenceThin` (n < 15).
 * Edge: with no matching records returns n = 0, null bands, and evidenceThin = true.
 */
export function compBands(level: string, region: string) {
  const rows = COHORT.filter((r) => r.endLevel === level && r.outcome === "reached" && r.region === region);
  const v = rows.map((r) => bandIdx(r.compBandEnd)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p25: null, p50: null, p75: null, evidenceThin: true };
  const b = (p: number) => bandAt(percentile(v, p));
  return { n: v.length, p25: b(0.25), p50: b(0.5), p75: b(0.75), evidenceThin: v.length < THIN_N };
}

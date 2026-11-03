export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
export const BANDS = ["B1", "B2", "B3", "B4", "B5"];
export const bandIdx = (b: string) => BANDS.indexOf(b);

/**
 * summaries.ts: one-line, human-readable descriptions of tool results.
 *
 * Used by the streaming trace panel ("findTwins: 150 comparable engineers") and by the
 * tool results fed back to the model. Pure and deterministic.
 */
import type { AnyEvidence } from "../tools/ledger";

const pct = (range: [number, number]): string =>
  `${Math.round(range[0] * 100)}-${Math.round(range[1] * 100)}%`;

/** A short description of what a tool call found. */
export function summarizeEvidence(evidence: AnyEvidence): string {
  switch (evidence.tool) {
    case "findTwins":
      return `findTwins: ${evidence.result.n} comparable engineers`;
    case "pathStats": {
      const r = evidence.result;
      if (r.n === 0) return `pathStats[${evidence.args.archetype}]: no comparable engineers`;
      const months = r.monthsP25 === null ? "no one reached it" : `${r.monthsP25}-${r.monthsP75} months`;
      const thin = r.evidenceThin ? " (limited evidence)" : "";
      return `pathStats[${evidence.args.archetype}]: n=${r.n}, reached ${pct(r.reachedRate)}, ${months}${thin}`;
    }
    case "compBands": {
      const r = evidence.result;
      return r.n === 0
        ? `compBands: no data for ${evidence.args.level} in ${evidence.args.region}`
        : `compBands: ${r.p25}-${r.p75} (n=${r.n}) for ${evidence.args.level} in ${evidence.args.region}`;
    }
    case "levelMap":
      return `levelMap: ${evidence.args.company} ${evidence.args.title} = ${evidence.result.canonicalLevel ?? "unknown"}`;
  }
}

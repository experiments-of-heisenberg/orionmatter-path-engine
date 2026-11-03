/**
 * findings.ts: the vocabulary of problems the verifier can find.
 *
 * A Finding is internal and precise; it is converted to a `Rejection` (the schema the
 * rest of the system and the UI use) when a verdict is assembled.
 */
import type { Rejection } from "../schemas";

/** Every kind of problem the deterministic verifier detects. */
export type FindingCode =
  | "unknown_evidence" // a claim cites an evidence id that is not in the ledger
  | "wrong_route_evidence" // a claim cites another route's evidence
  | "n_mismatch" // claim.n does not equal the sample size of any cited evidence
  | "range_unsupported" // claim.range matches no range in the cited evidence
  | "ungrounded_number" // prose contains a number that appears in no cited evidence
  | "overclaiming_language" // prose promises or guarantees an outcome
  | "window_out_of_range" // a step's month window falls outside [0, route upper bound]
  | "window_order" // a step's window is backwards or starts before the previous step
  | "missing_limited_evidence" // a thin route does not say "limited evidence"
  | "unknown_marker" // a step references a company marker that does not exist
  | "step_without_claim" // a step has no evidence-backed claim
  | "metrics_mismatch" // route metrics disagree with the ledger
  | "missing_caveat"; // the survivorship caveat is absent

export interface Finding {
  code: FindingCode;
  /** Index into plan.routes, or -1 for the whole plan. */
  routeIndex: number;
  stepIndex?: number;
  /** The offending text, or "(summary)" / "(metrics)" / "(caveats)". */
  text: string;
  /** Plain-language reason, written so the Planner can act on it. */
  message: string;
}

/** Convert findings to the rejection schema the rest of the system uses. */
export function toRejections(findings: readonly Finding[]): Rejection[] {
  return findings.map((finding) => ({
    code: finding.code,
    source: "verifier" as const,
    routeIndex: finding.routeIndex,
    ...(finding.stepIndex !== undefined ? { stepIndex: finding.stepIndex } : {}),
    claimText: finding.text,
    reason: finding.message,
  }));
}

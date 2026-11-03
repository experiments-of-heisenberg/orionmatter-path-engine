/**
 * verifier.ts: layer 1 of the Skeptic, the deterministic claim verifier.
 *
 * Pure code, no model. It rejects what code can PROVE wrong about a plan by checking it
 * against the evidence ledger. A claim that passes here is not "true" in the world (the
 * cohort is synthetic) but it is faithful: it says only what the cited evidence says.
 *
 * Checks, per route:
 *   metrics   route metrics equal what the ledger recorded
 *   prose     no promises; every number in it appears in the evidence it cites
 *   claims    cited ids exist and belong to this route; n and range match the evidence
 *   steps     each has a claim; month windows lie in [0, upper bound] and do not run backwards
 *   thin      a route with limited evidence must say so
 *   markers   referenced company markers exist
 * and for the plan: the survivorship caveat is present.
 */
import type { FactSheet } from "../engine";
import type { PlanResult, Route } from "../schemas";
import { MARKERS } from "../tools/data";
import type { AnyEvidence, EvidenceLedger } from "../tools/ledger";
import type { Finding } from "./findings";
import {
  findOverclaim,
  mentionsLimitedEvidence,
  numericLeaves,
  supportedNumbers,
  ungroundedNumbers,
} from "./textChecks";

export interface VerifierReport {
  findings: Finding[];
  /** How many claims were examined, for the trace ("checked 18 claims"). */
  claimsChecked: number;
}

/** Sample size recorded by a piece of evidence, if that tool reports one. */
function sampleSize(evidence: AnyEvidence): number | undefined {
  switch (evidence.tool) {
    case "findTwins":
    case "pathStats":
    case "compBands":
      return evidence.result.n;
    case "skillStats":
      return evidence.result.withSkill.n + evidence.result.withoutSkill.n;
    case "levelMap":
      return undefined;
  }
}

/** Ranges a claim may legitimately quote from one piece of evidence. */
function quotableRanges(evidence: AnyEvidence): [number, number][] {
  if (evidence.tool !== "pathStats") return [];
  const { monthsP25, monthsP75, reachedRate } = evidence.result;
  const ranges: [number, number][] = [reachedRate];
  if (monthsP25 !== null && monthsP75 !== null) ranges.push([monthsP25, monthsP75]);
  return ranges;
}

const sameRange = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  a[0] === b[0] && a[1] === b[1];

/** Verify one route; appends findings. Returns the number of claims examined. */
function verifyRoute(
  route: Route,
  routeIndex: number,
  ledger: EvidenceLedger,
  twinsEvidenceId: string,
  out: Finding[],
): number {
  const add = (code: Finding["code"], text: string, message: string, stepIndex?: number) =>
    out.push({ code, routeIndex, text, message, ...(stepIndex !== undefined ? { stepIndex } : {}) });

  const [statsId, compId] = route.evidenceIds;
  const allowedIds = new Set([statsId, compId, twinsEvidenceId]);

  // ---- metrics must equal the ledger (defence in depth: assemble already guarantees this) ----
  const statsEvidence = statsId ? ledger.get(statsId) : undefined;
  if (statsEvidence?.tool !== "pathStats") {
    add(
      "metrics_mismatch",
      "(metrics)",
      `The route's evidence id "${statsId ?? ""}" is not a pathStats record in the ledger.`,
    );
  } else {
    const r = statsEvidence.result;
    const expectedMonths = r.monthsP25 !== null && r.monthsP75 !== null ? [r.monthsP25, r.monthsP75] : null;
    const m = route.metrics;
    const monthsOk = JSON.stringify(m.monthsToGoal) === JSON.stringify(expectedMonths);
    if (m.evidenceN !== r.n || !sameRange(m.reachedRate, r.reachedRate) || !monthsOk) {
      add(
        "metrics_mismatch",
        "(metrics)",
        "The route's metrics (sample size, months, success rate) do not match the ledger.",
      );
    }
  }

  // Numbers a route-level statement may quote: everything in this route's own evidence.
  const routeEvidence = [statsId, compId]
    .flatMap((id) => (id ? [ledger.get(id)] : []))
    .filter(Boolean) as AnyEvidence[];
  const routeNumbers = supportedNumbers(routeEvidence.flatMap((e) => numericLeaves(e.result)));

  // ---- summary ----
  const promise = findOverclaim(route.summary);
  if (promise)
    add(
      "overclaiming_language",
      "(summary)",
      `The summary says "${promise}". Describe outcomes as what comparable engineers typically did, never as a promise.`,
    );
  const loose = ungroundedNumbers(route.summary, routeNumbers);
  if (loose.length > 0)
    add(
      "ungrounded_number",
      "(summary)",
      `The summary quotes ${loose.join(", ")}, which appears in none of this route's evidence.`,
    );

  // ---- steps and claims ----
  let claimsChecked = 0;
  let previousStart = 0;
  // Judge windows against the LEDGER, not the route's own metrics: if the metrics were
  // tampered with, that is reported once as metrics_mismatch rather than skewing every window.
  const upper =
    statsEvidence?.tool === "pathStats"
      ? (statsEvidence.result.monthsP75 ?? 0)
      : (route.metrics.monthsToGoal?.[1] ?? 0);
  const claimTexts: string[] = [];

  route.steps.forEach((step, stepIndex) => {
    if (step.whyItWorks.length === 0) {
      add(
        "step_without_claim",
        step.what,
        "This step has no evidence-backed claim explaining why it works.",
        stepIndex,
      );
    }

    const [start, end] = step.monthWindow;
    if (start > end) {
      add("window_order", step.what, `The month window [${start}, ${end}] runs backwards.`, stepIndex);
    } else if (start < previousStart) {
      add(
        "window_order",
        step.what,
        `The window starts at month ${start}, before the previous step started at month ${previousStart}.`,
        stepIndex,
      );
    } else if (end > upper || start < 0) {
      add(
        "window_out_of_range",
        step.what,
        `The window [${start}, ${end}] must lie within [0, ${upper}], the upper end of this route's months-to-goal range.`,
        stepIndex,
      );
    }
    previousStart = Math.max(previousStart, start);

    for (const markerId of step.companyMarkerIds) {
      if (!MARKERS.some((marker) => marker.id === markerId)) {
        add(
          "unknown_marker",
          markerId,
          `"${markerId}" is not a known company marker. Use only ids from the marker list.`,
          stepIndex,
        );
      }
    }

    for (const claim of step.whyItWorks) {
      claimsChecked++;
      claimTexts.push(claim.text);
      const cited: AnyEvidence[] = [];
      for (const id of claim.evidenceIds) {
        const evidence = ledger.get(id);
        if (!evidence) {
          add(
            "unknown_evidence",
            claim.text,
            `The claim cites "${id}", which is not in the ledger. Cite only ids from the fact sheet.`,
            stepIndex,
          );
        } else if (!allowedIds.has(id)) {
          add(
            "wrong_route_evidence",
            claim.text,
            `The claim cites "${id}", which belongs to a different route. Cite this route's own evidence ids.`,
            stepIndex,
          );
        } else {
          cited.push(evidence);
        }
      }

      if (cited.length > 0) {
        const sizes = cited.map(sampleSize).filter((n): n is number => n !== undefined);
        if (!sizes.includes(claim.n)) {
          add(
            "n_mismatch",
            claim.text,
            `The claim says n=${claim.n}, but the cited evidence has n=${sizes.join(" or ")}. Copy the sample size exactly.`,
            stepIndex,
          );
        }
        if (claim.range) {
          const range = claim.range;
          if (!cited.some((e) => quotableRanges(e).some((candidate) => sameRange(candidate, range)))) {
            add(
              "range_unsupported",
              claim.text,
              `The range [${range[0]}, ${range[1]}] matches neither the months-to-goal nor the success-rate range of the cited evidence. Copy a range exactly.`,
              stepIndex,
            );
          }
        }
        const supported = supportedNumbers([
          ...cited.flatMap((e) => numericLeaves(e.result)),
          claim.n,
          ...(claim.range ?? []),
        ]);
        const strays = ungroundedNumbers(claim.text, supported);
        if (strays.length > 0) {
          add(
            "ungrounded_number",
            claim.text,
            `The claim quotes ${strays.join(", ")}, which appears nowhere in the evidence it cites.`,
            stepIndex,
          );
        }
      }

      const claimPromise = findOverclaim(claim.text);
      if (claimPromise) {
        add(
          "overclaiming_language",
          claim.text,
          `The claim says "${claimPromise}". Describe what comparable engineers typically did; never promise or guarantee.`,
          stepIndex,
        );
      }
    }

    const whatPromise = findOverclaim(step.what);
    if (whatPromise)
      add(
        "overclaiming_language",
        step.what,
        `The step says "${whatPromise}". Do not promise outcomes.`,
        stepIndex,
      );
  });

  // ---- thin evidence must be acknowledged ----
  if (route.evidenceThin && ![route.summary, ...claimTexts].some(mentionsLimitedEvidence)) {
    add(
      "missing_limited_evidence",
      "(summary)",
      'This route rests on fewer than 15 comparable engineers. Say "limited evidence" in the summary or a claim.',
    );
  }

  return claimsChecked;
}

/**
 * Verify a whole plan against the ledger.
 *
 * @param plan   the assembled plan
 * @param ledger the session ledger the plan was built from
 * @param sheet  the fact sheet, used to know which evidence is the twin set
 */
export function verifyPlan(plan: PlanResult, ledger: EvidenceLedger, sheet: FactSheet): VerifierReport {
  const findings: Finding[] = [];
  let claimsChecked = 0;
  plan.routes.forEach((route, index) => {
    claimsChecked += verifyRoute(route, index, ledger, sheet.twins.evidenceId, findings);
  });

  const first = plan.caveats[0] ?? "";
  if (!/did not reach the goal|No comparable engineers/.test(first)) {
    findings.push({
      code: "missing_caveat",
      routeIndex: -1,
      text: "(caveats)",
      message: "The plan must lead with the survivorship-bias caveat.",
    });
  }
  return { findings, claimsChecked };
}

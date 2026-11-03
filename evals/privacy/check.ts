/**
 * check.ts: compare a Privacy Guard assessment with what a labeled case expects. Pure and tested
 * offline: the judge must be right before its verdicts mean anything.
 *
 * @returns plain-language failures; empty means the case passed
 */
import type { PrivacyAssessment } from "../../src/lib/privacy";
import type { PrivacyCase } from "./cases";

export function checkPrivacy(evalCase: PrivacyCase, result: PrivacyAssessment): string[] {
  const failures: string[] = [];
  const e = evalCase.expect;
  const lower = (text: string): string => text.toLowerCase();
  for (const want of e.mustFind ?? []) {
    const hit = result.findings.find(
      (f) =>
        lower(f.quote).includes(lower(want.quoteIncludes)) &&
        (want.category === undefined || f.category === want.category),
    );
    if (!hit)
      failures.push(
        `no finding contains "${want.quoteIncludes}"${want.category ? ` as ${want.category}` : ""}`,
      );
  }
  for (const banned of e.mustNotFind ?? []) {
    const hit = result.findings.find(
      (f) => lower(f.quote) === lower(banned) || lower(f.quote).split(/\W+/).includes(lower(banned)),
    );
    if (hit) failures.push(`flagged "${hit.quote}", which is not identifying`);
  }
  if (e.noModelFindings) {
    const model = result.findings.filter((f) => f.source === "model");
    if (model.length > 0)
      failures.push(`expected no model findings, got ${model.map((f) => `"${f.quote}"`).join(", ")}`);
  }
  if (result.textCheck !== "done") failures.push(`text check was "${result.textCheck}", not "done"`);
  if (result.findings.length > 0 && result.risk === "low") failures.push("findings exist but risk is low");
  for (const finding of result.findings) {
    if (result.generalisedText?.toLowerCase().includes(finding.quote.toLowerCase())) {
      failures.push(`the generalised text still contains "${finding.quote}"`);
    }
  }
  return failures;
}

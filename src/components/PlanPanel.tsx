/**
 * PlanPanel.tsx: the Plan tab.
 *
 * "Build my plan" starts the full run (Planner, then Skeptic, then revisions if needed). While it runs the Agent
 * Trace fills in live. When it ends the plan is shown whatever the Skeptic said: approved plans put numbered steps
 * on the map; an unresolved plan is shown with its objections and a warning, never dressed up as approved. A plan
 * is tied to the limits it was made for and says so when they have changed.
 */
import type { ClientPlanRun } from "../lib/api/serialize";
import type { Constraints } from "../lib/schemas";
import { ARCHETYPE_LABEL, type Archetype } from "../ui/format";
import { planHeadline, planIsStale, routeOf, windowText, type PlanState } from "../ui/plan";
import { currentStage } from "../ui/trace";
import { TracePanel } from "./TracePanel";
import { h } from "../ui/display";

export interface PlanPanelProps {
  plan: PlanState;
  current: Constraints;
  selected: Archetype;
  onSelect: (archetype: Archetype) => void;
  onBuild: () => void;
}

const ARCHETYPES: Archetype[] = ["climb", "jump", "pivot"];

/** What an evidence id stands for, for the chip's tooltip. */
function evidenceTitle(result: ClientPlanRun, id: string): string {
  return result.evidence.find((e) => e.evidenceId === id)?.summary ?? "Evidence from the cohort";
}

function RouteSteps({ result, archetype }: { result: ClientPlanRun; archetype: Archetype }) {
  const route = routeOf(result, archetype);
  if (!route) return null;
  return (
    <div className="plan-route">
      <p className="panel__lede">{h(route.summary)}</p>
      {route.evidenceThin && (
        <p className="notice">Limited evidence: few comparable engineers stand behind this route.</p>
      )}
      <ol className="plan-steps-list" aria-label={`Steps on the ${ARCHETYPE_LABEL[archetype]} route`}>
        {route.steps.map((step, index) => (
          <li key={`${index}-${step.what}`} className="plan-stepcard">
            <div className="plan-stepcard__head">
              <span className="plan-stepcard__n" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="plan-stepcard__what">
                <span className="sr-only">Step {index + 1}: </span>
                {h(step.what)}
              </h3>
              <span className="tag tag--gray">{windowText(step.monthWindow)}</span>
            </div>
            {step.whyItWorks.length > 0 && (
              <ul className="plan-claims">
                {step.whyItWorks.map((claim) => (
                  <li key={claim.text}>
                    {h(claim.text)}{" "}
                    <span className="plan-claims__meta">
                      Based on {claim.n} engineer{claim.n === 1 ? "" : "s"}.
                    </span>{" "}
                    {claim.evidenceIds.map((id) => (
                      <code key={id} className="evidence-chip" title={evidenceTitle(result, id)}>
                        {id}
                      </code>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {step.proofNeeded.length > 0 && (
              <p className="plan-stepcard__line">
                <strong>Proof to gather:</strong> {step.proofNeeded.join("; ")}
              </p>
            )}
            {step.gapClosers.length > 0 && (
              <p className="plan-stepcard__line">
                <strong>Gaps to close:</strong> {step.gapClosers.join("; ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PlanPanel({ plan, current, selected, onSelect, onBuild }: PlanPanelProps) {
  const running = plan.phase === "running";
  const result = plan.phase === "done" ? plan.result : undefined;
  const stale = planIsStale(plan, current);
  return (
    <div className="plan">
      <section className="panel" aria-labelledby="plan-title">
        <div className="controls__head">
          <h2 className="panel__title" id="plan-title">
            Your plan
          </h2>
          <button type="button" className="button button--primary" disabled={running} onClick={onBuild}>
            {running ? "Working\u2026" : result ? "Build it again" : "Build my plan"}
          </button>
        </div>
        <p className="panel__lede">
          Muse Spark writes the three routes using only evidence code looks up in the cohort. Then the Skeptic
          checks every figure against that evidence and sends the plan back if anything does not match. It
          takes about half a minute.
        </p>
        {running && (
          <p className="plan__status" role="status">
            {currentStage(plan.trace) ?? "Starting\u2026"}
          </p>
        )}
        {plan.phase === "error" && (
          <div className="notice notice--error" role="alert">
            <p>{plan.error}</p>
            <button type="button" className="button" onClick={onBuild}>
              Try again
            </button>
          </div>
        )}
        {stale && (
          <p className="notice" role="status">
            This plan was made for earlier limits. The numbers on the other tabs have moved since.{" "}
            <button type="button" className="button" onClick={onBuild}>
              Build it for your current limits
            </button>
          </p>
        )}
        {result && (
          <>
            <p className={`plan__verdict plan__verdict--${result.status}`}>
              <span aria-hidden="true">{result.status === "approved" ? "\u2713" : "!"}</span>{" "}
              {planHeadline(result)}
            </p>
            {result.status === "approved" && !stale && (
              <p className="panel__fine">The steps of the selected route are numbered on the Map tab.</p>
            )}
            <div className="choices plan__routes" role="group" aria-label="Route to show">
              {ARCHETYPES.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="choice"
                  aria-pressed={a === selected}
                  onClick={() => onSelect(a)}
                >
                  {ARCHETYPE_LABEL[a]}
                </button>
              ))}
            </div>
            <RouteSteps result={result} archetype={selected} />
            <h3 className="panel__sub">What this plan cannot tell you</h3>
            <ul className="plan__caveats">
              {result.plan.caveats.map((c) => (
                <li key={c}>{h(c)}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      {(plan.phase !== "idle" || plan.trace.items.length > 0) && (
        <TracePanel trace={plan.trace} running={running} />
      )}
    </div>
  );
}

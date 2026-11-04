/**
 * TracePanel.tsx: the Agent Trace. It shows, in order, what the agents did to produce a plan.
 *
 * Planner stages, every evidence lookup (who chose it, what came back, the id a claim can cite), and every
 * objection the Skeptic raised with the exact words it objected to. Nothing is staged: the items are exactly the
 * events the run streamed. Every state is also said in words ("Running", "Failed", "approved"), never by colour alone.
 */
import { groupRejections, verdictHeadline, traceSummary, type Trace, type TraceItem } from "../ui/trace";

const STATUS_WORD = { running: "Running", ok: "Done", error: "Failed" } as const;

function Item({ item, active }: { item: TraceItem; active: boolean }) {
  switch (item.kind) {
    case "stage":
      return (
        <li className={`trace__stage${active ? " trace__stage--active" : ""}`}>
          <span className="trace__dot" aria-hidden="true" />
          <span>
            {item.label}
            {item.round !== undefined && item.round > 0 ? ` (round ${item.round})` : ""}
          </span>
          {active && <span className="sr-only"> (in progress)</span>}
        </li>
      );
    case "call":
      return (
        <li className="trace__call">
          <p className="trace__call-head">
            <span className="trace__call-label">{item.label}</span>
            <span className={`tag ${item.by === "agent" ? "tag--start" : "tag--amber"}`}>
              {item.by === "agent" ? "Chosen by Muse Spark" : "Filled in by code"}
            </span>
            <span className={`trace__status trace__status--${item.status}`}>{STATUS_WORD[item.status]}</span>
          </p>
          {(item.summary || item.evidenceId) && (
            <p className="trace__summary">
              {item.summary}
              {item.evidenceId && (
                <>
                  {" "}
                  <span className="sr-only">Evidence id</span>
                  <code className="evidence-chip">{item.evidenceId}</code>
                </>
              )}
            </p>
          )}
        </li>
      );
    case "note":
      return <li className="trace__note">{item.message}</li>;
    case "verdict":
      return (
        <li className={`trace__verdict trace__verdict--${item.approved ? "approved" : "rejected"}`}>
          <p className="trace__verdict-head">
            <span aria-hidden="true">{item.approved ? "\u2713" : "\u2715"}</span> {verdictHeadline(item)}
          </p>
          {groupRejections(item.rejections).map((group) => (
            <div key={group.code} className="trace__group">
              <p className="trace__group-title">{group.title}</p>
              <ul>
                {group.items.map((r, i) => (
                  <li key={`${r.routeIndex}-${r.stepIndex ?? "x"}-${i}`}>
                    <q>{r.claimText.length > 140 ? `${r.claimText.slice(0, 137)}\u2026` : r.claimText}</q>
                    <span className="trace__reason"> {r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {item.notes.length > 0 && (
            <ul className="trace__notes">
              {item.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </li>
      );
  }
}

export function TracePanel({ trace, running }: { trace: Trace; running: boolean }) {
  const lastStage = trace.items.map((i) => i.kind).lastIndexOf("stage");
  return (
    <section className="panel trace" aria-labelledby="trace-title">
      <h2 className="panel__title" id="trace-title">
        Agent trace
      </h2>
      <p className="panel__lede">
        What happened, in order. Muse Spark chooses which evidence to look up; code runs each lookup and the
        Skeptic checks every figure in the plan against the results.
      </p>
      {trace.items.length === 0 ? (
        <p className="panel__fine">{running ? "Starting\u2026" : "Nothing has run yet."}</p>
      ) : (
        <ol className="trace__list" aria-label="Agent trace">
          {trace.items.map((item, index) => (
            <Item
              key={`${item.kind}-${index}`}
              item={item}
              active={running && index === lastStage && !trace.finished}
            />
          ))}
        </ol>
      )}
      {trace.truncated && <p className="panel__fine">Only the first {trace.items.length} items are shown.</p>}
      {trace.items.length > 0 && <p className="panel__fine">{traceSummary(trace)}.</p>}
    </section>
  );
}

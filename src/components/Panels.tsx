/** Panels.tsx: the detail under the map, the Compare tab and the Why tab. */
"use client";
import type { ClientRoute, ClientSheet } from "../lib/api/serialize";
import { RADAR_BASIS } from "../lib/engine/radar";
import {
  ARCHETYPE_LABEL,
  bandRange,
  engineersText,
  monthsRange,
  percentRange,
  routeStatus,
  statusBadge,
  summaryLine,
  type Archetype,
} from "../ui/format";
import { ROUTE_COLORS } from "../ui/palette";
import { RADAR_AXES } from "../ui/radar";
import { DistributionChart, OutcomeBar } from "./Charts";
import { RadarChart } from "./RadarChart";

/** The "outside your limits" note is a share of the outcome bar, not a risk to watch out for. */
const isRealRisk = (risk: string): boolean => !risk.includes("outside your limits");

/** The selected route in more detail: how long it took, what happened to people, what showed up. */
export function RouteDetail({ route, maxMonths }: { route: ClientRoute; maxMonths: number | undefined }) {
  const status = routeStatus(route);
  return (
    <section
      className="panel"
      aria-labelledby="detail-title"
      style={{ ["--route" as string]: ROUTE_COLORS[route.archetype].ui }}
    >
      <h2 id="detail-title" className="panel__title">
        <span className="route-dot" /> {ARCHETYPE_LABEL[route.archetype]} in detail
      </h2>
      <p className="panel__lede">{summaryLine(route)}</p>
      {status === "no_data" ? null : (
        <div className="detail-grid">
          <div>
            <h3 className="panel__sub">How long it took</h3>
            <DistributionChart route={route} maxMonths={maxMonths} />
          </div>
          <div>
            <h3 className="panel__sub">What happened to {engineersText(route.n)}</h3>
            <OutcomeBar route={route} />
            <div className="chips">
              {route.topGates.length > 0 && (
                <div className="chips__row">
                  <span className="chips__label">Skills that showed up</span>
                  {route.topGates.map((g) => (
                    <span key={g} className="chip">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {route.topCompanyTypes.length > 0 && (
                <div className="chips__row">
                  <span className="chips__label">Typical stops</span>
                  {route.topCompanyTypes.map((g) => (
                    <span key={g} className="chip">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {route.topRisks.filter(isRealRisk).length > 0 && (
                <div className="chips__row">
                  <span className="chips__label">Watch out for</span>
                  {route.topRisks.filter(isRealRisk).map((g) => (
                    <span key={g} className="chip chip--amber">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {route.skills.length > 0 && (
                <div className="chips__row chips__row--block">
                  <span className="chips__label">Skills you asked about</span>
                  <ul className="skill-list">
                    {route.skills.map((skill) => (
                      <li key={skill.skill}>
                        {skill.stats.known ? (
                          <>
                            <strong>{skill.stats.cohortSkill}</strong>:{" "}
                            {percentRange(skill.stats.withSkill.reachedRate)} with it (n=
                            {skill.stats.withSkill.n}) vs {percentRange(skill.stats.withoutSkill.reachedRate)}{" "}
                            without (n=
                            {skill.stats.withoutSkill.n}).{" "}
                            {skill.stats.distinguishable
                              ? "The ranges do not overlap, so it goes with a real difference."
                              : "The ranges overlap, so we cannot tell a difference."}
                            {skill.stats.evidenceThin ? " Limited evidence." : ""}
                          </>
                        ) : (
                          <>
                            <strong>{skill.skill}</strong>: the data has no evidence about this skill.
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** True when this route has the (joint) highest score on an axis among routes that have data. */
export function isBest(
  routes: readonly ClientRoute[],
  axis: keyof ClientRoute["radar"],
  route: ClientRoute,
): boolean {
  const best = Math.max(...routes.filter((r) => r.n > 0).map((r) => r.radar[axis]));
  return route.radar[axis] === best;
}

/** Compare tab: the radar, with toggles, and a table of the same facts. */
export function ComparePanel({
  sheet,
  selected,
  hidden,
  onToggle,
}: {
  sheet: ClientSheet;
  selected: Archetype;
  hidden: ReadonlySet<Archetype>;
  onToggle: (archetype: Archetype) => void;
}) {
  return (
    <section className="panel" aria-labelledby="compare-title">
      <h2 id="compare-title" className="panel__title">
        Compare the routes
      </h2>
      <div className="compare">
        <div className="compare__radar">
          <RadarChart routes={sheet.routes} selected={selected} hidden={hidden} />
          <ul className="legend-toggles">
            {sheet.routes.map((r) => (
              <li key={r.archetype}>
                <button
                  type="button"
                  className="toggle"
                  aria-pressed={!hidden.has(r.archetype)}
                  onClick={() => onToggle(r.archetype)}
                  disabled={r.n === 0}
                >
                  <span className="swatch" style={{ background: ROUTE_COLORS[r.archetype].ui }} />{" "}
                  {ARCHETYPE_LABEL[r.archetype]}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="compare__table-wrap">
          <table className="compare__table">
            <caption className="sr-only">The three routes side by side</caption>
            <thead>
              <tr>
                <th scope="col">&nbsp;</th>
                {sheet.routes.map((r) => (
                  <th key={r.archetype} scope="col">
                    <span
                      className="route-dot"
                      style={{ ["--route" as string]: ROUTE_COLORS[r.archetype].ui }}
                    />{" "}
                    {ARCHETYPE_LABEL[r.archetype]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Typical time</th>
                {sheet.routes.map((r) => (
                  <td key={r.archetype}>
                    {r.n === 0
                      ? "No data"
                      : r.reachedN > 0
                        ? monthsRange(r.monthsToGoal)
                        : "None within limits"}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Reached it</th>
                {sheet.routes.map((r) => (
                  <td key={r.archetype}>{r.n > 0 ? percentRange(r.reachedRate) : "No data"}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Pay band</th>
                {sheet.routes.map((r) => (
                  <td key={r.archetype}>{bandRange(r.compBandRange)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Evidence</th>
                {sheet.routes.map((r) => (
                  <td key={r.archetype}>
                    n={r.n}
                    {statusBadge(routeStatus(r)) === "Limited evidence" ? " (limited)" : ""}
                  </td>
                ))}
              </tr>
              {RADAR_AXES.map((axis) => (
                <tr key={axis.key}>
                  <th scope="row">{axis.label} score</th>
                  {sheet.routes.map((r) => (
                    <td
                      key={r.archetype}
                      className={r.n > 0 && isBest(sheet.routes, axis.key, r) ? "cell--best" : undefined}
                    >
                      {r.n > 0 ? r.radar[axis.key] : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Why tab: how the order was decided, what the numbers mean, and what they cannot tell you. */
export function WhyPanel({ sheet }: { sheet: ClientSheet }) {
  const percent = Math.round(sheet.survivorship.notReachedShare * 100);
  return (
    <section className="panel" aria-labelledby="why-title">
      <h2 id="why-title" className="panel__title">
        How to read this
      </h2>
      <div className="why-grid">
        <div>
          <h3 className="panel__sub">Why this order</h3>
          <p>{sheet.ranking.basis}</p>
          <h3 className="panel__sub">What a range means</h3>
          <p>
            Success is a 95% range for the share of comparable engineers who reached the goal, and time is the
            middle half of how long they took. A wide range means few engineers or a lot of variety. We show
            the number of engineers beside every figure, and mark routes with fewer than 15 as limited
            evidence.
          </p>
          <h3 className="panel__sub">What this cannot tell you</h3>
          <p>
            Of {sheet.survivorship.totalTwins} comparable engineers across these routes, about {percent}% did
            not reach the goal. People who struggle on a path are less likely to share it, so real-world
            success may be lower than any cohort suggests. This is a planning aid for you, not a promise.
          </p>
          <p className="panel__fine">
            The data is a synthetic cohort of generated career histories. It shows how the method works, not
            how any real company behaves.
          </p>
        </div>
        <div>
          <h3 className="panel__sub">The six measures</h3>
          <dl className="basis">
            {RADAR_AXES.map((axis) => (
              <div key={axis.key}>
                <dt>{axis.label}</dt>
                <dd>{RADAR_BASIS[axis.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

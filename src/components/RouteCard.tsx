/** RouteCard.tsx: one route in plain words: a big range, where it sits on the time scale, how many made it. */
import type { ClientRoute } from "../lib/api/serialize";
import {
  ARCHETYPE_BLURB,
  ARCHETYPE_LABEL,
  bandRange,
  engineersText,
  monthsRange,
  percentRange,
  routeStatus,
  statusBadge,
} from "../ui/format";
import { ROUTE_COLORS } from "../ui/palette";
import { RangeBar, SuccessMeter } from "./Charts";

interface Props {
  route: ClientRoute;
  axisMax: number;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}

export function RouteCard({ route, axisMax, selected, recommended, onSelect }: Props) {
  const status = routeStatus(route);
  const badge = statusBadge(status);
  const color = ROUTE_COLORS[route.archetype].ui;
  const empty = status === "none_within_limits" || status === "no_data";
  const name = ARCHETYPE_LABEL[route.archetype];
  return (
    <article
      className={`route-card${selected ? " route-card--selected" : ""}${empty ? " route-card--empty" : ""}`}
      style={{ ["--route" as string]: color }}
      onClick={onSelect}
    >
      <header className="route-card__head">
        <span className="route-card__dot" />
        <h3 className="route-card__name">
          <button type="button" className="route-card__button" aria-pressed={selected} onClick={onSelect}>
            {name}
          </button>
        </h3>
        <div className="route-card__tags">
          {recommended && !empty && <span className="tag tag--start">Start here</span>}
          {badge && (
            <span className={`tag ${status === "limited" ? "tag--amber" : "tag--gray"}`}>{badge}</span>
          )}
        </div>
      </header>
      <p className="route-card__blurb">{ARCHETYPE_BLURB[route.archetype]}</p>

      {empty ? (
        <div className="route-card__empty">
          <p className="route-card__big route-card__big--muted">
            {status === "no_data" ? "No data" : "Not within your limits"}
          </p>
          <p className="route-card__small">
            {status === "none_within_limits"
              ? `${Math.round(route.ignoringLimits.reachedShare * 100)}% of ${engineersText(route.n)} reached it, but not within your limits. The fastest took ${route.ignoringLimits.fastestMonths ?? "?"} months.`
              : "No comparable engineers matched, so there is no evidence for this route."}
          </p>
        </div>
      ) : (
        <>
          <p className="route-card__big">{monthsRange(route.monthsToGoal)}</p>
          <RangeBar
            range={route.monthsToGoal}
            median={route.monthsMedian}
            max={axisMax}
            color={color}
            label={`Typical time ${monthsRange(route.monthsToGoal)} on a scale from 0 to ${axisMax} months`}
          />
          <p className="route-card__stat">
            <strong>{percentRange(route.reachedRate)}</strong> reached it
          </p>
          <SuccessMeter
            range={route.reachedRate}
            color={color}
            label={`Success range ${percentRange(route.reachedRate)} on a scale from 0 to 100 percent`}
          />
        </>
      )}

      <dl className="route-card__facts">
        <div>
          <dt>Evidence</dt>
          <dd>
            {engineersText(route.n)}
            {!empty && `, ${route.reachedN} made it`}
          </dd>
        </div>
        {!empty && (
          <div>
            <dt>Pay band reached</dt>
            <dd>{bandRange(route.compBandRange)}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

/**
 * Charts.tsx: the small charts that sit beside the map. Each one is a plain SVG or HTML drawing with a
 * text equivalent right next to it, so the page reads the same without sight of the picture.
 */
import type { ClientRoute } from "../lib/api/serialize";
import { binPoints, tallest, zoomDomain } from "../ui/histogram";
import { roundedShares } from "../ui/format";
import { ROUTE_COLORS } from "../ui/palette";

/** A horizontal bar on a 0 to `max` scale with a band for the typical window and a tick for the median. */
export function RangeBar({
  range,
  median,
  max,
  color,
  label,
}: {
  range: readonly [number, number] | null;
  median: number | null;
  max: number;
  color: string;
  label: string;
}) {
  const pct = (v: number): number => Math.min(100, Math.max(0, (v / max) * 100));
  return (
    <div className="rangebar" role="img" aria-label={label}>
      <div className="rangebar__track" />
      {range && (
        <div
          className="rangebar__band"
          style={{
            left: `${pct(range[0])}%`,
            width: `${Math.max(1.5, pct(range[1]) - pct(range[0]))}%`,
            background: color,
          }}
        />
      )}
      {median !== null && <div className="rangebar__tick" style={{ left: `${pct(median)}%` }} />}
      <div className="rangebar__scale" aria-hidden="true">
        <span>0</span>
        <span>{Math.round(max / 2)}</span>
        <span>{max} mo</span>
      </div>
    </div>
  );
}

/** The 95% range of the success rate on a 0 to 100% scale. */
export function SuccessMeter({
  range,
  color,
  label,
}: {
  range: readonly [number, number];
  color: string;
  label: string;
}) {
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className="meter__track" />
      <div
        className="meter__band"
        style={{
          left: `${range[0] * 100}%`,
          width: `${Math.max(1.5, (range[1] - range[0]) * 100)}%`,
          background: color,
        }}
      />
    </div>
  );
}

const W = 520;
const H = 156;
const PAD = { left: 12, right: 12, top: 22, bottom: 26 };

/** How long it took: a bar for every six months, with the typical window shaded and the person's limit marked. */
export function DistributionChart({
  route,
  maxMonths,
}: {
  route: ClientRoute;
  maxMonths: number | undefined;
}) {
  const domain = zoomDomain(route.reachedPoints, maxMonths);
  const bins = binPoints(route.reachedPoints, domain);
  const top = tallest(bins);
  const color = ROUTE_COLORS[route.archetype].ui;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (months: number): number =>
    PAD.left +
    ((Math.min(Math.max(months, domain.from), domain.to) - domain.from) / (domain.to - domain.from)) * innerW;
  const barW = (innerW / bins.length) * 0.78;
  const total = route.reachedPoints.length;
  const within = route.reachedPoints.filter((p) => p.within).length;
  const first = route.reachedPoints[0]?.months;
  const last = route.reachedPoints[route.reachedPoints.length - 1]?.months;
  const summary =
    total === 0
      ? "No comparable engineer reached the goal on this route."
      : `${total} comparable engineers reached the goal, between ${first} and ${last} months.` +
        (maxMonths !== undefined ? ` ${within} of them within your limits.` : "");
  const ticks: number[] = [];
  const step = domain.to - domain.from > 48 ? 12 : 6;
  for (let m = Math.ceil(domain.from / step) * step; m <= domain.to; m += step) ticks.push(m);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="chart__svg">
        {route.monthsToGoal && (
          <rect
            x={x(route.monthsToGoal[0])}
            y={PAD.top - 6}
            width={Math.max(2, x(route.monthsToGoal[1]) - x(route.monthsToGoal[0]))}
            height={innerH + 6}
            fill={color}
            opacity={0.14}
            rx={4}
          />
        )}
        {route.monthsToGoal && (
          <text x={x(route.monthsToGoal[0]) + 2} y={PAD.top - 10} className="chart__window-label">
            Typical window
          </text>
        )}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          className="chart__axis"
        />
        {bins.map((bin) => {
          const hWithin = (bin.within / top) * innerH;
          const hOutside = (bin.outside / top) * innerH;
          const bx = x(bin.start) + (innerW / bins.length - barW) / 2;
          const baseY = PAD.top + innerH;
          return (
            <g key={bin.start}>
              {bin.outside > 0 && (
                <rect
                  x={bx}
                  y={baseY - hWithin - hOutside}
                  width={barW}
                  height={hOutside}
                  className="chart__late"
                  rx={2}
                />
              )}
              {bin.within > 0 && (
                <rect x={bx} y={baseY - hWithin} width={barW} height={hWithin} fill={color} rx={2} />
              )}
            </g>
          );
        })}
        {route.monthsMedian !== null && (
          <path
            d={`M ${x(route.monthsMedian)} ${PAD.top + innerH + 2} l -4 7 l 8 0 z`}
            className="chart__median"
          />
        )}
        {maxMonths !== undefined && (
          <g>
            <line
              x1={x(maxMonths)}
              x2={x(maxMonths)}
              y1={PAD.top - 8}
              y2={PAD.top + innerH}
              className="chart__limit"
            />
            <text x={x(maxMonths) + 4} y={PAD.top - 1} className="chart__limit-label">
              Your limit
            </text>
          </g>
        )}
        {ticks.map((m) => (
          <text
            key={m}
            x={x(m)}
            y={H - 6}
            textAnchor={m === ticks[0] ? "start" : m === ticks[ticks.length - 1] ? "end" : "middle"}
            className="chart__tick"
          >
            {`${m} mo`}
          </text>
        ))}
      </svg>
      <figcaption className="chart__caption">
        <span className="chart__key">
          <span className="swatch" style={{ background: color }} />
          {maxMonths !== undefined ? "Within your limits" : "Reached the goal"}
        </span>
        {maxMonths !== undefined && (
          <span className="chart__key">
            <span className="swatch swatch--late" />
            Reached it, but later
          </span>
        )}
        <span className="chart__summary">{summary}</span>
      </figcaption>
    </figure>
  );
}

/** What happened to comparable engineers on this route, as one bar that adds to 100%. */
export function OutcomeBar({ route }: { route: ClientRoute }) {
  const limited = route.outcomeShares.outsideLimits > 0;
  const color = ROUTE_COLORS[route.archetype].ui;
  const parts = [
    {
      key: "reached",
      label: limited ? "Reached it within your limits" : "Reached the goal",
      value: route.outcomeShares.reached,
      className: "",
      color,
    },
    ...(limited
      ? [
          {
            key: "late",
            label: "Reached it, but outside your limits",
            value: route.outcomeShares.outsideLimits,
            className: "outcome__seg--late",
            color: "",
          },
        ]
      : []),
    {
      key: "stalled",
      label: "Stalled",
      value: route.outcomeShares.stalled,
      className: "outcome__seg--stalled",
      color: "",
    },
    {
      key: "left",
      label: "Left the field",
      value: route.outcomeShares.leftField,
      className: "outcome__seg--left",
      color: "",
    },
  ];
  const shares = roundedShares(parts.map((p) => p.value));
  return (
    <div className="outcome">
      <div
        className="outcome__bar"
        role="img"
        aria-label={parts.map((p, i) => `${p.label} ${shares[i]} percent`).join(", ")}
      >
        {parts.map((p, i) =>
          (shares[i] ?? 0) > 0 ? (
            <div
              key={p.key}
              className={`outcome__seg ${p.className}`}
              style={{ width: `${shares[i]}%`, ...(p.color ? { background: p.color } : {}) }}
            />
          ) : null,
        )}
      </div>
      <ul className="outcome__legend">
        {parts.map((p, i) => (
          <li key={p.key}>
            <span
              className={`swatch ${p.className.replace("outcome__seg", "swatch")}`}
              style={p.color ? { background: p.color } : undefined}
            />
            {p.label} <strong>{shares[i]}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

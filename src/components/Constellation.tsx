/**
 * Constellation.tsx: the map. A time chart dressed as a star chart.
 *
 * Distance to the right is months from today. You are the node on the left; each route is a thin line
 * ending in a star at its typical arrival time, with a soft band for the typical window. Star size is how
 * many comparable engineers made it. Everything is drawn from `layoutMap` (tested, pure); this file only
 * paints. The text under the map and the cards beside it say the same things in words, so nothing here is
 * conveyed by the drawing alone.
 */
import type { ClientRoute } from "../lib/api/serialize";
import { ARCHETYPE_LABEL, monthsRange, percentRange, routeAriaLabel, type Archetype } from "../ui/format";
import { COMPACT, DESKTOP, layoutMap, type LaneLayout, type MapLayout } from "../ui/mapLayout";
import { GOAL_GOLD, ROUTE_COLORS } from "../ui/palette";

interface Props {
  routes: readonly ClientRoute[];
  maxMonths: number | undefined;
  selected: Archetype;
  onSelect: (archetype: Archetype) => void;
  goalLabel: string;
  youLabel: string;
}

/** A concave four-point star centred on (cx, cy). */
function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.22;
  return `M ${cx} ${cy - r} Q ${cx + k} ${cy - k} ${cx + r} ${cy} Q ${cx + k} ${cy + k} ${cx} ${cy + r} Q ${cx - k} ${cy + k} ${cx - r} ${cy} Q ${cx - k} ${cy - k} ${cx} ${cy - r} Z`;
}

function Lane({
  lane,
  route,
  selected,
  dimmed,
  compact,
  onSelect,
}: {
  lane: LaneLayout;
  route: ClientRoute;
  selected: boolean;
  dimmed: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const color = ROUTE_COLORS[lane.archetype].map;
  const thin = lane.status === "limited";
  const solid = lane.status === "ok";
  const label = ARCHETYPE_LABEL[lane.archetype];
  const labelX = compact ? lane.star.x + 10 : lane.label.x;
  return (
    <g
      className={`lane${selected ? " lane--selected" : ""}${dimmed ? " lane--dim" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={routeAriaLabel(route)}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {/* a wide invisible stroke makes the thin line easy to hit with a finger or a mouse */}
      <path d={lane.path} fill="none" stroke="transparent" strokeWidth={22} />
      {lane.window && (
        <path
          className="lane__window"
          d={lane.window}
          fill="none"
          stroke={color}
          strokeWidth={selected ? 13 : 9}
          strokeLinecap="round"
          opacity={selected ? 0.3 : 0.18}
        />
      )}
      <path
        className="lane__line"
        d={lane.path}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.2 : 1.4}
        strokeLinecap="round"
        strokeDasharray={lane.ghost ? "1 7" : thin ? "7 6" : undefined}
        opacity={lane.ghost ? 0.55 : 1}
      />
      <g className="lane__star" style={{ transform: `translate(${lane.star.x}px, ${lane.star.y}px)` }}>
        {lane.ghost ? (
          <>
            <circle r={6} fill="#0B1020" stroke={color} strokeWidth={1.4} strokeDasharray="2 2" />
            <path
              d="M -2.6 -2.6 L 2.6 2.6 M 2.6 -2.6 L -2.6 2.6"
              stroke={color}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </>
        ) : lane.status === "no_data" ? (
          <circle r={4} fill="none" stroke={color} strokeWidth={1.2} opacity={0.6} />
        ) : (
          <>
            <circle r={lane.radius + 6} fill={color} opacity={selected ? 0.16 : 0.08} />
            <path
              d={sparkle(0, 0, lane.radius + 2)}
              fill={solid ? color : "#0B1020"}
              stroke={color}
              strokeWidth={thin ? 1.4 : 0.6}
            />
            {solid && <circle r={1.8} fill="#fff" />}
          </>
        )}
      </g>
      <g className="lane__label" style={{ transform: `translate(${labelX}px, ${lane.label.y}px)` }}>
        <text className="map-title" fill={color} y={compact ? -9 : -6}>
          {label}
        </text>
        <text className="map-value" y={compact ? 8 : 12}>
          {lane.ghost
            ? "None within limits"
            : monthsRange(route.monthsToGoal).replace(" months", compact ? " mo" : " months")}
        </text>
        {!compact && (
          <text className="map-note" y={28}>
            {lane.ghost
              ? `Fastest took ${route.ignoringLimits.fastestMonths ?? "?"} mo`
              : lane.status === "no_data"
                ? "No data"
                : `${percentRange(route.reachedRate)} · n=${route.n}`}
          </text>
        )}
        {compact && !lane.ghost && lane.status !== "no_data" && (
          <text className="map-note" y={22}>
            {percentRange(route.reachedRate)}
          </text>
        )}
      </g>
    </g>
  );
}

function MapSvg({
  layout,
  routes,
  maxMonths,
  selected,
  onSelect,
  goalLabel,
  youLabel,
  compact,
}: Props & { layout: MapLayout; compact: boolean }) {
  const { size } = layout;
  const baseline = size.height - 26;
  return (
    <svg
      className="constellation__svg"
      viewBox={`0 0 ${size.width} ${size.height}`}
      role="group"
      aria-label={`Map of three routes to ${goalLabel}. Distance to the right is months from today.`}
    >
      <defs>
        <pattern
          id={`late-${compact ? "c" : "d"}`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke="#F2C76E" strokeOpacity="0.10" strokeWidth="2" />
        </pattern>
      </defs>
      {layout.dust.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#fff" opacity={d.o} />
      ))}

      {/* the time axis */}
      {layout.ticks.map((tick) => (
        <g key={tick.months}>
          <line
            x1={tick.x}
            x2={tick.x}
            y1={size.padTop - 22}
            y2={baseline - 6}
            stroke="#fff"
            strokeOpacity={0.06}
            strokeDasharray="2 6"
          />
          <text className="map-tick" x={tick.x} y={baseline + 14} textAnchor="middle">
            {tick.months === 0 ? "Today" : compact ? `${tick.months}` : `${tick.months} mo`}
          </text>
        </g>
      ))}
      <line
        x1={size.padLeft}
        x2={size.width - size.padRight}
        y1={baseline - 6}
        y2={baseline - 6}
        stroke="#fff"
        strokeOpacity={0.16}
      />

      {/* the person's time limit */}
      {layout.limit && maxMonths !== undefined && (
        <g className="map-limit">
          <rect
            x={layout.limit.x}
            y={size.padTop - 28}
            width={Math.max(0, size.width - size.padRight + 40 - layout.limit.x)}
            height={baseline - size.padTop + 22}
            fill={`url(#late-${compact ? "c" : "d"})`}
          />
          <line
            x1={layout.limit.x}
            x2={layout.limit.x}
            y1={size.padTop - 28}
            y2={baseline - 6}
            stroke={GOAL_GOLD}
            strokeWidth={1.2}
            strokeDasharray="5 4"
          />
          <text className="map-limit-label" x={layout.limit.x - 6} y={size.padTop - 34} textAnchor="end">
            {`Your limit · ${maxMonths} mo`}
          </text>
        </g>
      )}

      {/* you */}
      <g className="map-you" style={{ transform: `translate(${layout.origin.x}px, ${layout.origin.y}px)` }}>
        <circle r={16} fill="#fff" opacity={0.06} />
        <circle r={8} fill="#0B1020" stroke="#fff" strokeWidth={1.6} />
        <circle r={2.6} fill="#fff" />
        <text className="map-you-label" y={30} textAnchor="middle">
          You today
        </text>
        <text className="map-note" y={46} textAnchor="middle">
          {youLabel}
        </text>
      </g>

      {layout.lanes.map((lane) => {
        const route = routes.find((r) => r.archetype === lane.archetype);
        if (!route) return null;
        return (
          <Lane
            key={lane.archetype}
            lane={lane}
            route={route}
            selected={selected === lane.archetype}
            dimmed={selected !== lane.archetype}
            compact={compact}
            onSelect={() => onSelect(lane.archetype)}
          />
        );
      })}
    </svg>
  );
}

export function Constellation(props: Props) {
  const desktop = layoutMap(props.routes, props.maxMonths, DESKTOP);
  const compact = layoutMap(props.routes, props.maxMonths, COMPACT);
  return (
    <div className="constellation">
      <div className="constellation__head">
        <span className="constellation__title">Your routes to {props.goalLabel}</span>
        <ul className="constellation__legend" aria-label="How to read the map">
          <li>
            <span className="legend-dot legend-dot--line" /> Distance is months from today
          </li>
          <li>
            <span className="legend-dot legend-dot--band" /> Soft band is the typical window
          </li>
          <li>
            <span className="legend-dot legend-dot--star" /> Bigger star means more engineers made it
          </li>
          <li>
            <span className="legend-dot legend-dot--hollow" /> Hollow and dashed means limited evidence
          </li>
        </ul>
      </div>
      <div className="constellation__body constellation__body--desktop">
        <MapSvg {...props} layout={desktop} compact={false} />
      </div>
      <div className="constellation__body constellation__body--compact">
        <MapSvg {...props} layout={compact} compact />
      </div>
    </div>
  );
}

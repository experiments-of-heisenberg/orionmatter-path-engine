/** RadarChart.tsx: six measures, three routes, one picture. Every axis is an absolute 0 to 100 score, higher is better. */
import type { ClientRoute } from "../lib/api/serialize";
import { ARCHETYPE_LABEL, type Archetype } from "../ui/format";
import { ROUTE_COLORS } from "../ui/palette";
import { axisPoint, RADAR_AXES, radarPolygon, ringPolygon } from "../ui/radar";

const SIZE = 320;
const C = SIZE / 2;
const R = 104;

export function RadarChart({
  routes,
  selected,
  hidden,
}: {
  routes: readonly ClientRoute[];
  selected: Archetype;
  hidden: ReadonlySet<Archetype>;
}) {
  const visible = routes.filter((r) => r.n > 0 && !hidden.has(r.archetype));
  const description = routes
    .filter((r) => r.n > 0)
    .map(
      (r) =>
        `${ARCHETYPE_LABEL[r.archetype]}: ${RADAR_AXES.map((a) => `${a.label} ${r.radar[a.key]}`).join(", ")}`,
    )
    .join(". ");
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="radar"
      role="img"
      aria-label={`Radar comparing the routes on six measures from 0 to 100. ${description}`}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ringPolygon(f, C, C, R)} className="radar__ring" />
      ))}
      {RADAR_AXES.map((axis, i) => {
        const end = axisPoint(i, 1, C, C, R);
        const label = axisPoint(i, 1.2, C, C, R);
        return (
          <g key={axis.key}>
            <line x1={C} y1={C} x2={end.x} y2={end.y} className="radar__spoke" />
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="radar__label"
            >
              {axis.label}
            </text>
          </g>
        );
      })}
      {visible.map((route) => {
        const color = ROUTE_COLORS[route.archetype].ui;
        const isSelected = route.archetype === selected;
        return (
          <polygon
            key={route.archetype}
            points={radarPolygon(route.radar, C, C, R)}
            fill={color}
            fillOpacity={isSelected ? 0.22 : 0.08}
            stroke={color}
            strokeWidth={isSelected ? 2.2 : 1.3}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

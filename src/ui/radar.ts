/** radar.ts: geometry of the six-axis compare chart. Values are 0 to 100, higher is more favourable. */
import type { Radar } from "../lib/schemas";

export const RADAR_AXES: readonly { key: keyof Radar; label: string }[] = [
  { key: "comp", label: "Pay" },
  { key: "speed", label: "Speed" },
  { key: "risk", label: "Odds" },
  { key: "learning", label: "Learning" },
  { key: "balance", label: "Balance" },
  { key: "stability", label: "Stability" },
];

export interface Pt {
  x: number;
  y: number;
}

/** The point for an axis at a given fraction (0 to 1) of the radius. Axis 0 points straight up. */
export function axisPoint(index: number, fraction: number, cx: number, cy: number, radius: number): Pt {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / RADAR_AXES.length;
  return {
    x: Math.round((cx + Math.cos(angle) * radius * fraction) * 10) / 10,
    y: Math.round((cy + Math.sin(angle) * radius * fraction) * 10) / 10,
  };
}

/** The polygon for one route, as an SVG points string. Values outside 0 to 100 are clamped. */
export function radarPolygon(radar: Radar, cx: number, cy: number, radius: number): string {
  return RADAR_AXES.map(({ key }, i) => {
    const fraction = Math.min(100, Math.max(0, radar[key])) / 100;
    const p = axisPoint(i, fraction, cx, cy, radius);
    return `${p.x},${p.y}`;
  }).join(" ");
}

/** A grid ring (a hexagon) at a fraction of the radius. */
export function ringPolygon(fraction: number, cx: number, cy: number, radius: number): string {
  return RADAR_AXES.map((_, i) => {
    const p = axisPoint(i, fraction, cx, cy, radius);
    return `${p.x},${p.y}`;
  }).join(" ");
}

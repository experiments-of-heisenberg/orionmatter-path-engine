/** palette.ts: the colours of the three routes, tuned for the dark map panel and for the light page. */
import type { Archetype } from "./format";

export interface RouteColor {
  /** On the dark map panel. */
  map: string;
  /** On the light page (charts, chips). */
  ui: string;
}

export const ROUTE_COLORS: Readonly<Record<Archetype, RouteColor>> = {
  climb: { map: "#7DB4FF", ui: "#3B82F6" },
  jump: { map: "#FF9F8F", ui: "#EF6A52" },
  pivot: { map: "#B7A6FF", ui: "#7C5CFF" },
};

/** The goal star. */
export const GOAL_GOLD = "#F2C76E";

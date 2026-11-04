/**
 * TrailCard.tsx: the shareable card, drawn as one SVG of fixed size so that what is previewed is exactly what is saved.
 *
 * It shows the title, only the personal details the privacy ladder allows, the time limit if there is one, and the three
 * routes with their ranges and engineer counts. Colour never carries meaning alone: every route is named, the best-fit
 * route says "Start here", and a route nobody finished says so in words. System fonts are used so a saved PNG looks
 * the same on any device.
 */
import { forwardRef } from "react";
import { ROUTE_COLORS } from "../ui/palette";
import {
  CARD_HEIGHT,
  CARD_TEXT_WIDTH,
  CARD_WIDTH,
  ROUTE_TEXT_WIDTH,
  textFit,
  titleFontSize,
  type TrailCardModel,
} from "../ui/trailCard";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const TrailCard = forwardRef<SVGSVGElement, { model: TrailCardModel }>(function TrailCard(
  { model },
  ref,
) {
  const left = 72;
  const details = model.shown.length > 0 ? model.shown.join("  \u00b7  ") : "Details withheld to protect you";
  const line = (r: TrailCardModel["routes"][number]): string =>
    `${r.time}${r.evidence ? `  \u00b7  ${r.evidence}` : ""}`;
  const barX = 640;
  const barW = 480;
  const x = (months: number): number =>
    barX + (Math.min(Math.max(months, 0), model.axisMax) / model.axisMax) * barW;
  const rowsTop = 292;
  const rowGap = 92;
  return (
    <svg
      ref={ref}
      className="trail-card"
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
      width="100%"
      role="img"
      aria-label={`Trail card. ${model.title}. ${model.routes.map((r) => `${r.label}: ${r.time}`).join(". ")}.`}
      fontFamily={FONT}
    >
      <defs>
        <linearGradient id="card-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#141c3f" />
          <stop offset="1" stopColor="#0a0f22" />
        </linearGradient>
      </defs>
      <rect width={CARD_WIDTH} height={CARD_HEIGHT} rx="28" fill="url(#card-bg)" />
      <text x={left} y="76" fill="#9aa5d6" fontSize="22" fontWeight="600" letterSpacing="2">
        ORIONMATTER
      </text>
      <text
        x={left}
        y="150"
        fill="#ffffff"
        fontSize={titleFontSize(model.title)}
        fontWeight="700"
        {...textFit(model.title, titleFontSize(model.title), CARD_TEXT_WIDTH)}
      >
        {model.title}
      </text>
      <text x={left} y="196" fill="#c9d1f2" fontSize="26" {...textFit(details, 26, CARD_TEXT_WIDTH)}>
        {details}
      </text>
      {model.limit && (
        <text x={left} y="234" fill="#F2C76E" fontSize="22" fontWeight="600">
          {model.limit}
        </text>
      )}
      {model.routes.map((route, i) => {
        const y = rowsTop + i * rowGap;
        const color = ROUTE_COLORS[route.archetype].map;
        return (
          <g key={route.archetype}>
            <circle cx={left + 10} cy={y + 8} r="9" fill={color} />
            <text x={left + 36} y={y + 16} fill="#ffffff" fontSize="30" fontWeight="650">
              {route.label}
            </text>
            {route.startHere && (
              <g>
                <rect
                  x={left + 36 + route.label.length * 17 + 14}
                  y={y - 12}
                  width="128"
                  height="32"
                  rx="16"
                  fill="#2a3470"
                />
                <text
                  x={left + 36 + route.label.length * 17 + 78}
                  y={y + 10}
                  fill="#cfd6ff"
                  fontSize="18"
                  fontWeight="650"
                  textAnchor="middle"
                >
                  Start here
                </text>
              </g>
            )}
            <text
              x={left + 36}
              y={y + 48}
              fill="#c9d1f2"
              fontSize="22"
              {...textFit(line(route), 22, ROUTE_TEXT_WIDTH)}
            >
              {line(route)}
            </text>
            <line
              x1={barX}
              x2={barX + barW}
              y1={y + 8}
              y2={y + 8}
              stroke="#ffffff"
              strokeOpacity="0.14"
              strokeWidth="2"
            />
            {route.window && (
              <rect
                x={x(route.window[0])}
                y={y - 2}
                width={Math.max(4, x(route.window[1]) - x(route.window[0]))}
                height="20"
                rx="10"
                fill={color}
                fillOpacity="0.4"
              />
            )}
            {route.median !== null && <circle cx={x(route.median)} cy={y + 8} r="8" fill={color} />}
          </g>
        );
      })}
      <text x={barX} y={rowsTop - 36} fill="#8f9ac8" fontSize="18">
        Months from today
      </text>
      <text x={barX} y={rowsTop + 2 * rowGap + 50} fill="#8f9ac8" fontSize="18">
        0
      </text>
      <text x={barX + barW} y={rowsTop + 2 * rowGap + 50} fill="#8f9ac8" fontSize="18" textAnchor="end">
        {model.axisMax}
      </text>
      <text x={left} y={CARD_HEIGHT - 38} fill="#8f9ac8" fontSize="20">
        {model.footer}
      </text>
    </svg>
  );
});

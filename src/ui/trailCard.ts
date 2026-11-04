/**
 * trailCard.ts: the shareable trail card, as a model.
 *
 * The card is a picture of someone's three routes that they can post. It must not give them away, so it shows only the
 * personal details that keep them inside a crowd of at least k comparable engineers: the Privacy tab's disclosure ladder
 * decides. Details beyond the last rung that passes are withheld and listed as withheld, never silently dropped, and
 * details the ladder does not count (years of experience, technologies, a name) are never shown at all. The routes
 * themselves are cohort ranges with their engineer counts, so they identify no one. Nothing is uploaded: the card is
 * built, drawn and saved in the browser. All of the decisions live here, as pure functions, so they are tested.
 */
import type { ClientSheet } from "../lib/api/serialize";
import type { PrivacyAssessment } from "../lib/privacy";
import { ARCHETYPE_LABEL, monthsRange, percentRange, routeStatus, type Archetype } from "./format";
import { type Person, REGION_LABEL, ROLE_LABEL } from "./sample";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** One route as the card shows it. */
export interface CardRoute {
  archetype: Archetype;
  label: string;
  /** "34–40 months", or what happened instead. */
  time: string;
  /** "74–92% · 55 engineers", or empty when nobody matched. */
  evidence: string;
  /** The typical window and median as months, for the little bar; null when there is none. */
  window: [number, number] | null;
  median: number | null;
  startHere: boolean;
  status: ReturnType<typeof routeStatus>;
}

export interface TrailCardModel {
  title: string;
  /** Details the card shows. */
  shown: string[];
  /** Details withheld to keep the crowd at k or more, in words. */
  withheld: string[];
  /** Comparable engineers who match what is shown (the last passing rung), or null when even the first detail is too few. */
  crowd: number | null;
  k: number;
  /** The person's time limit in words, or undefined. */
  limit: string | undefined;
  routes: CardRoute[];
  /** Months the little bars run to (a whole number of years, at least 36). */
  axisMax: number;
  footer: string;
}

/** The words for one ladder step's detail. */
function detailFor(rung: { added: string; shared: string }, person: Person): string {
  switch (rung.added) {
    case "role":
      return ROLE_LABEL[person.profile.roleFamily];
    case "level":
      return person.profile.level;
    case "goal":
      return `Goal: ${person.goal.label}`;
    case "region":
      return REGION_LABEL[person.profile.region] ?? person.profile.region;
    case "company type":
      return rung.shared.split(", ").at(-1) ?? "A company type";
    default:
      return rung.added;
  }
}

/** Build the card from a person, their routes and the privacy ladder for the chosen k. */
export function trailCardModel(
  person: Person,
  sheet: ClientSheet,
  privacy: Pick<PrivacyAssessment, "ladder" | "k">,
): TrailCardModel {
  const rungs = privacy.ladder;
  // The crowd only shrinks, so the rungs that pass are a prefix; stop at the first that does not.
  const firstFail = rungs.findIndex((r) => !r.passes);
  const passing = firstFail === -1 ? rungs : rungs.slice(0, firstFail);
  const blocked = firstFail === -1 ? [] : rungs.slice(firstFail);
  const shown = passing.map((r) => detailFor(r, person));
  const withheld = blocked.map(
    (r) => `${detailFor(r, person)} (withheld to keep you in a crowd of ${privacy.k} or more)`,
  );
  const goalShown = passing.some((r) => r.added === "goal");
  const axisMax = Math.max(
    36,
    Math.ceil(
      Math.max(0, ...sheet.routes.map((r) => r.monthsToGoal?.[1] ?? 0), person.constraints.maxMonths ?? 0) /
        12,
    ) * 12,
  );
  return {
    title: goalShown ? `My route to ${person.goal.label}` : "My routes to the next level",
    shown,
    withheld,
    crowd: passing.at(-1)?.size ?? null,
    k: privacy.k,
    limit:
      person.constraints.maxMonths === undefined
        ? undefined
        : `Within ${person.constraints.maxMonths} months`,
    routes: sheet.routes.map((r) => {
      const status = routeStatus(r);
      const none = status === "no_data" || status === "none_within_limits";
      return {
        archetype: r.archetype,
        label: ARCHETYPE_LABEL[r.archetype],
        time:
          status === "no_data"
            ? "No comparable engineers"
            : status === "none_within_limits"
              ? "None within these limits"
              : monthsRange(r.monthsToGoal),
        evidence:
          status === "no_data"
            ? ""
            : `${percentRange(r.reachedRate)} \u00b7 ${r.n} engineer${r.n === 1 ? "" : "s"}${status === "limited" ? " \u00b7 limited evidence" : ""}`,
        window: none ? null : r.monthsToGoal,
        median: none ? null : r.monthsMedian,
        startHere: sheet.ranking.recommended === r.archetype,
        status,
      };
    }),
    axisMax,
    footer: "Synthetic cohort of 484 engineers. Ranges, not promises.",
  };
}

/** The card as plain text, for pasting where a picture cannot go. */
export function cardText(model: TrailCardModel): string {
  const lines = [model.title, model.shown.join(" \u00b7 ")];
  if (model.limit) lines.push(model.limit);
  lines.push("");
  for (const r of model.routes) {
    lines.push(
      `${r.label}${r.startHere ? " (start here)" : ""}: ${r.time}${r.evidence ? `. ${r.evidence}` : ""}`,
    );
  }
  lines.push("", model.footer);
  return lines.join("\n");
}

/** A font size that keeps the title inside the card. */
export function titleFontSize(title: string): number {
  if (title.length <= 24) return 60;
  if (title.length <= 36) return 48;
  return 38;
}

/** A safe file name for a download: lower-case letters, digits and dashes. */
export function cardFileName(model: TrailCardModel, extension: "png" | "svg"): string {
  const base =
    model.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "trail-card";
  return `${base}.${extension}`;
}

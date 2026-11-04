/**
 * readmeImages.tsx: the pictures in the README, drawn by the real components.
 *
 * Two self-contained SVG files: the constellation map for the sample engineer with the steps of the recorded, approved plan
 * numbered along the climb route, and the trail card. They are produced by the same code the app runs, from the same recorded
 * data, so they cannot drift into mock-ups: a test compares the committed files with a fresh render and fails when the screen
 * changed, which is the reminder to run `npm run docs:images`.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Constellation } from "../../src/components/Constellation";
import { TrailCard } from "../../src/components/TrailCard";
import { handleExplore, handlePlan, handlePrivacy } from "../../src/lib/api/handlers";
import { PlanRequest, PrivacyRequest } from "../../src/lib/api/schemas";
import type { Services } from "../../src/lib/api/services";
import { parseEnv } from "../../src/lib/env";
import { FileFixtureStore, createModelClient } from "../../src/lib/model";
import { levelTitle } from "../../src/ui/display";
import { SAMPLE_PERSON } from "../../src/ui/sample";
import { trailCardModel } from "../../src/ui/trailCard";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** The CSS rules the map's drawing needs (text styling, line weights), copied from the app's own stylesheet. */
function mapStyles(): string {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rules: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    if (!/(^|,)\s*\.(map-|plan-step)/.test(selector)) continue;
    if (/:hover|:focus/.test(selector)) continue;
    rules.push(`${selector}{${(match[2] ?? "").replace(/\s+/g, " ").trim()}}`);
  }
  return rules.join("\n");
}

/** The map for the sample engineer, with the approved plan's steps on the climb route. */
export async function renderMapSvg(): Promise<string> {
  const person = SAMPLE_PERSON;
  const data = handleExplore(PlanRequest.parse(person));
  const env = parseEnv({ USE_FIXTURES: "true" });
  const client = createModelClient(env, {
    fixtureMode: "replay",
    fixtures: new FileFixtureStore("src/fixtures"),
  });
  const plan = await handlePlan(
    { client } as unknown as Services,
    PlanRequest.parse(person),
    () => undefined,
  );
  const climb = plan.plan.routes.find((r) => r.archetype === "climb");
  const html = renderToStaticMarkup(
    <Constellation
      routes={data.routes}
      maxMonths={undefined}
      selected="climb"
      onSelect={() => undefined}
      goalLabel={person.goal.label}
      youLabel={levelTitle(person.profile.level)}
      {...(climb ? { planSteps: { archetype: "climb" as const, steps: climb.steps } } : {})}
    />,
  );
  const svg = /<svg class="constellation__svg"[\s\S]*?<\/svg>/.exec(html)?.[0];
  if (!svg) throw new Error("the desktop map was not found in the rendered markup");
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 480" width="1000" height="480" font-family="${FONT}" role="img" aria-label="Constellation map of three routes to ${person.goal.label} for the sample engineer. Distance to the right is months from today.">`,
    `<defs><radialGradient id="sky" cx="25%" cy="30%" r="120%"><stop offset="0" stop-color="#16204a"/><stop offset="0.55" stop-color="#0e1530"/><stop offset="1" stop-color="#0a0f22"/></radialGradient></defs>`,
    `<style>${mapStyles()}</style>`,
    `<rect width="1000" height="480" rx="18" fill="url(#sky)"/>`,
    `<text x="28" y="34" fill="#eef2ff" font-size="17" font-weight="600">Your routes to ${person.goal.label}</text>`,
    `<text x="28" y="56" fill="#8e9bbd" font-size="12.5">Distance is months from today. Bigger star: more engineers made it. Numbers: steps of the approved plan. Synthetic cohort of 484 engineers.</text>`,
    `<g transform="translate(0 30)">${inner}</g>`,
    `</svg>`,
    "",
  ].join("\n");
}

/** The trail card for the sample engineer at the default crowd size. */
export async function renderCardSvg(): Promise<string> {
  const person = SAMPLE_PERSON;
  const data = handleExplore(PlanRequest.parse(person));
  const ladder = await handlePrivacy(
    {
      client: { chat: () => Promise.reject(new Error("no model needed for the ladder")) },
    } as unknown as Services,
    PrivacyRequest.parse({ profile: person.profile, goal: person.goal, k: 10 }),
    () => undefined,
  );
  const html = renderToStaticMarkup(<TrailCard model={trailCardModel(person, data, ladder)} />);
  const svg = /<svg[\s\S]*<\/svg>/.exec(html)?.[0];
  if (!svg) throw new Error("the card was not found in the rendered markup");
  return `${svg
    .replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(' width="100%"', ' width="1200" height="630"')}\n`;
}

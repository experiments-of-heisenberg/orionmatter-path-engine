/**
 * render-preview.tsx: render the screen to static HTML files for a visual check, with no browser server.
 *
 * Usage: npx tsx scripts/render-preview.tsx [outputDirectory]
 * It writes one HTML file per state (map, compare, why, a time-limited map, a phone-width map). Each file is
 * self-contained: the real CSS and the real markup, from the same components the app uses.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PathView, type Tab } from "../src/components/PathApp";
import { IDLE_BINDINGS, type WhatIfBindings } from "../src/components/WhatIfPanel";
import { handleExplore, handlePlan, handleWhatIf } from "../src/lib/api/handlers";
import { PlanRequest, WhatIfRequest } from "../src/lib/api/schemas";
import type { Services } from "../src/lib/api/services";
import type { AgentEvent } from "../src/lib/agents";
import { createMockClient, reply, type ChatRequest } from "../src/lib/model";
import { draftFromRequest } from "../tests/helpers/fixturesData";
import { planFinished, planProgress, planStarted, type PlanState } from "../src/ui/plan";
import { finishTurn, startTurn, type Turn } from "../src/ui/chat";
import { SAMPLE_PERSON, type Person } from "../src/ui/sample";
import { addScenario, type Scenario } from "../src/ui/scenarios";

const out = process.argv[2] ?? "/tmp/preview";
mkdirSync(out, { recursive: true });
const css = readFileSync("src/app/globals.css", "utf8").replace(/var\(--font-geist-sans\)/g, '"Inter"');

function page(
  person: Person,
  tab: Tab,
  selected: "climb" | "jump" | "pivot",
  whatIf?: WhatIfBindings,
  plan?: PlanState,
): string {
  const data = handleExplore(PlanRequest.parse(person));
  const body = renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab={tab}
      selected={selected}
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
      {...(whatIf ? { whatIf } : {})}
      {...(plan ? { plan } : {})}
    />,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
}

/** A What if tab as it looks mid-conversation: limits changed, two turns, two saved scenarios. */
async function whatIfBindings(): Promise<{ person: Person; bindings: WhatIfBindings }> {
  const start = handleExplore(PlanRequest.parse(SAMPLE_PERSON));
  const asked = async (
    message: string,
    steps: ReturnType<typeof reply>[],
    current = SAMPLE_PERSON.constraints,
  ) => {
    const request = WhatIfRequest.parse({
      message,
      current,
      profile: SAMPLE_PERSON.profile,
      goal: SAMPLE_PERSON.goal,
      narrate: false,
    });
    return handleWhatIf({ client: createMockClient(steps) } as unknown as Services, request, () => undefined);
  };
  const says = (output: object) =>
    reply(
      JSON.stringify({ unsupported: [], contradictions: [], clarification: null, changes: [], ...output }),
    );
  const first = await asked("What if I won't relocate and want to get there within 2 years?", [
    says({
      changes: [
        { field: "noRelocation", value: true, phrase: "I won't relocate" },
        { field: "maxMonths", value: 24, phrase: "within 2 years" },
      ],
    }),
  ]);
  const second = await asked(
    "I want more money, and a 4-day week",
    [
      says({
        unsupported: [{ phrase: "a 4-day week", reason: "Work-week length is not in the cohort data." }],
        clarification: {
          question: "Which minimum pay band do you want? B1 is lowest, B5 highest.",
          about: "minCompBand",
          options: ["B3", "B4", "B5"],
        },
      }),
    ],
    first.interpretation.next,
  );
  let turns: Turn[] = [];
  const t1 = startTurn(turns, "What if I won't relocate and want to get there within 2 years?");
  turns = finishTurn(t1.turns, t1.id, first);
  const t2 = startTurn(turns, "I want more money, and a 4-day week");
  turns = finishTurn(t2.turns, t2.id, second);
  const person: Person = { ...SAMPLE_PERSON, constraints: first.interpretation.next };
  const now = handleExplore(PlanRequest.parse(person));
  let scenarios: Scenario[] = [];
  const a = addScenario(scenarios, SAMPLE_PERSON.constraints, start);
  scenarios = a.list;
  const b = addScenario(scenarios, person.constraints, now);
  scenarios = b.list;
  return {
    person,
    bindings: {
      ...IDLE_BINDINGS,
      baseline: start,
      changed: true,
      turns,
      scenarios,
      scenarioNotice: "Saved as Scenario B.",
    },
  };
}

/** A plan run as the screen would show it: the real handler, a scripted model, every event folded into the trace. */
async function approvedPlanState(): Promise<PlanState> {
  const events: AgentEvent[] = [];
  const request = PlanRequest.parse(SAMPLE_PERSON);
  // The scripted Planner skips its tool calls (code fills them in) and writes a draft whose claims cite the evidence.
  const WHAT = [
    "Take on a cross-team technical project",
    "Lead the design of a system others rely on",
    "Mentor engineers and write the proposal for Staff",
  ];
  const compose = (chat: ChatRequest) => {
    const draft = JSON.parse(draftFromRequest(chat)) as {
      routes: { steps: { what: string; monthWindow: number[] }[] }[];
    };
    for (const route of draft.routes) {
      route.steps.forEach((step, i) => {
        step.what = WHAT[i] ?? step.what;
      });
    }
    return reply(JSON.stringify(draft));
  };
  const client = createMockClient([reply("EVIDENCE COMPLETE"), compose, reply('{"issues":[],"notes":[]}')]);
  const result = await handlePlan({ client } as unknown as Services, request, (e) => events.push(e));
  let state = planStarted(SAMPLE_PERSON.constraints);
  for (const e of events) state = planProgress(state, e);
  return planFinished(state, result);
}

const limited: Person = { ...SAMPLE_PERSON, constraints: { ...SAMPLE_PERSON.constraints, maxMonths: 24 } };
const live = await whatIfBindings();
const planned = await approvedPlanState();
const files: [string, string][] = [
  ["map", page(SAMPLE_PERSON, "map", "climb")],
  ["compare", page(SAMPLE_PERSON, "compare", "climb")],
  ["why", page(SAMPLE_PERSON, "why", "climb")],
  ["limited", page(limited, "map", "jump")],
  ["whatif", page(live.person, "whatif", "jump", live.bindings)],
  ["plan", page(SAMPLE_PERSON, "plan", "climb", undefined, planned)],
  ["map-plan", page(SAMPLE_PERSON, "map", "climb", undefined, planned)],
];
for (const [name, html] of files) writeFileSync(`${out}/${name}.html`, html);
// Phone view: a 390px column with the small-screen rules switched on unconditionally, because a static page
// cannot resize its own viewport and a nested frame would not be allowed to load here.
const phoneCss = css.replace(/@media \(max-width: (?:720|860)px\) \{/g, "@media all {");
const phoneOf = (html: string): string =>
  html.replace(
    /<style>[\s\S]*?<\/style>/,
    `<style>${phoneCss}</style><style>body{max-width:390px;margin:0 auto;box-shadow:0 0 0 1px #ccc}</style>`,
  );
writeFileSync(`${out}/phone.html`, phoneOf(files[0]?.[1] ?? ""));
writeFileSync(`${out}/whatif-phone.html`, phoneOf(files[4]?.[1] ?? ""));
writeFileSync(`${out}/map-plan-phone.html`, phoneOf(files[6]?.[1] ?? ""));
console.log(`wrote ${files.length + 2} files to ${out}`);

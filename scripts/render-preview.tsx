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
import { IDLE_INTAKE, type IntakeBindings } from "../src/components/useIntake";
import { IDLE_PRIVACY, type PrivacyBindings } from "../src/components/usePrivacy";
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
  extra: { privacy?: PrivacyBindings; intake?: IntakeBindings; isSample?: boolean } = {},
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
      {...(extra.privacy ? { privacy: extra.privacy } : {})}
      {...(extra.intake ? { intake: extra.intake } : {})}
      {...(extra.isSample !== undefined ? { isSample: extra.isSample } : {})}
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

async function privacyBindings(): Promise<PrivacyBindings> {
  const { handlePrivacy } = await import("../src/lib/api/handlers");
  const { PrivacyRequest } = await import("../src/lib/api/schemas");
  const story =
    "I worked at Acme Robotics on the Orion arm project. Mail me at jo@example.com. I earned 4200000 rupees in 2023.";
  const asked = (body: object, steps: ReturnType<typeof reply>[]) =>
    handlePrivacy(
      { client: createMockClient(steps) } as unknown as Services,
      PrivacyRequest.parse({ profile: SAMPLE_PERSON.profile, goal: SAMPLE_PERSON.goal, ...body }),
      () => undefined,
    );
  const ladder = await asked({}, []);
  const withText = await asked({ text: story }, [
    reply(
      JSON.stringify({
        findings: [
          { quote: "Acme Robotics", category: "employer", reason: "a named company" },
          { quote: "Orion arm project", category: "project_or_product", reason: "a named project" },
        ],
      }),
    ),
  ]);
  return {
    ...IDLE_PRIVACY,
    ladder: { phase: "done", result: ladder },
    draft: story,
    textCheck: { phase: "done", result: withText, usedModel: true, settings: IDLE_PRIVACY.settings },
  };
}

async function intakeBindings(): Promise<IntakeBindings> {
  const { handleIntake } = await import("../src/lib/api/handlers");
  const { IntakeRequest } = await import("../src/lib/api/schemas");
  const { formFromDraft } = await import("../src/ui/intake");
  const text =
    "I'm L5 backend engineer, 7 years in IN-south, working with Go and Kubernetes. I want to reach L6 Staff Engineer.";
  const none = {
    roleFamily: null,
    level: null,
    company: null,
    title: null,
    yearsExperience: null,
    region: null,
    compBand: null,
    stack: [],
    milestones: [],
    goal: null,
  };
  const result = await handleIntake(
    {
      client: createMockClient([
        reply(
          JSON.stringify({
            ...none,
            roleFamily: { value: "backend", quote: "backend engineer" },
            level: { value: "L5", quote: "L5 backend" },
            yearsExperience: { value: 7, quote: "7 years" },
            region: { value: "IN-south", quote: "IN-south" },
            stack: ["go", "kubernetes"],
            goal: { targetLevel: "L6", label: "Staff Engineer", quote: "L6 Staff Engineer" },
          }),
        ),
      ]),
    } as unknown as Services,
    IntakeRequest.parse({ text }),
    () => undefined,
  );
  return { ...IDLE_INTAKE, text, phase: "done", result, form: formFromDraft(result.draft) };
}

const limited: Person = { ...SAMPLE_PERSON, constraints: { ...SAMPLE_PERSON.constraints, maxMonths: 24 } };
const live = await whatIfBindings();
const planned = await approvedPlanState();
const privacyState = await privacyBindings();
const intakeState = await intakeBindings();
const files: [string, string][] = [
  ["map", page(SAMPLE_PERSON, "map", "climb")],
  ["compare", page(SAMPLE_PERSON, "compare", "climb")],
  ["why", page(SAMPLE_PERSON, "why", "climb")],
  ["limited", page(limited, "map", "jump")],
  ["whatif", page(live.person, "whatif", "jump", live.bindings)],
  ["plan", page(SAMPLE_PERSON, "plan", "climb", undefined, planned)],
  ["map-plan", page(SAMPLE_PERSON, "map", "climb", undefined, planned)],
  ["privacy", page(SAMPLE_PERSON, "privacy", "climb", undefined, undefined, { privacy: privacyState })],
  ["share", page(SAMPLE_PERSON, "share", "climb", undefined, undefined, { privacy: privacyState })],
  ["you", page(SAMPLE_PERSON, "you", "climb", undefined, undefined, { intake: intakeState, isSample: true })],
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

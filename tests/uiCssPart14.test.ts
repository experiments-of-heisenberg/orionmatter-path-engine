/**
 * The stylesheet's Part 14 half: every class the Plan, Privacy, Your story and Share tabs render
 * is styled, the new sections' variables exist in both themes, accent text stays readable, the
 * small-screen rules collapse the new grids, and reduced motion still kills the trace pulse.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PathView, type Tab } from "../src/components/PathApp";
import { IDLE_INTAKE, type IntakeBindings } from "../src/components/useIntake";
import { IDLE_PRIVACY, type PrivacyBindings } from "../src/components/usePrivacy";
import type { ClientPlanRun } from "../src/lib/api/serialize";
import type { IntakeResult } from "../src/lib/intake";
import type { PrivacyAssessment } from "../src/lib/privacy";
import { planFailed, planFinished, planProgress, planStarted, type PlanState } from "../src/ui/plan";
import { SAMPLE_PERSON, type Person } from "../src/ui/sample";
import { editedKeys, formFromDraft } from "../src/ui/intake";
import { fullReading, partialReading, read, STORY_TEXT } from "./helpers/intake";
import { approvedPlan } from "./helpers/plan";
import { assessed, modelFindings, STORY } from "./helpers/privacy";
import { exploreFor } from "./helpers/ui";

const css = readFileSync("src/app/globals.css", "utf8");
const noop = () => undefined;

let approved: ClientPlanRun;
let donePlan: PlanState;
let ladder10: PrivacyAssessment;
let ladder70: PrivacyAssessment;
let ladderRobotics: PrivacyAssessment;
let withText: PrivacyAssessment;
let full: IntakeResult;
let partial: IntakeResult;
beforeAll(async () => {
  const run = await approvedPlan();
  approved = run.result;
  let s = planStarted(SAMPLE_PERSON.constraints);
  for (const e of run.events) s = planProgress(s, e);
  donePlan = planFinished(s, approved);
  ladder10 = await assessed();
  ladder70 = await assessed({ k: 70 });
  ladderRobotics = await assessed({ companyType: "robotics" });
  withText = await assessed({ text: STORY }, [modelFindings]);
  full = await read({ text: STORY_TEXT }, [fullReading]);
  partial = await read({ text: "I'm L5 backend engineer" }, [partialReading]);
});

function intakeFor(result: IntakeResult, over: Partial<IntakeBindings> = {}): IntakeBindings {
  const form = formFromDraft(result.draft);
  return {
    ...IDLE_INTAKE,
    phase: "done",
    result,
    form,
    edited: editedKeys(form, form),
    ...over,
  };
}

function view(
  tab: Tab,
  extra: {
    person?: Person;
    plan?: PlanState;
    privacy?: PrivacyBindings;
    intake?: IntakeBindings;
  } = {},
): string {
  const { person, data } = exploreFor();
  return renderToStaticMarkup(
    createElement(PathView, {
      person: extra.person ?? person,
      data,
      error: undefined,
      tab,
      selected: "climb",
      onTab: noop,
      onSelect: noop,
      onRetry: noop,
      ...(extra.plan ? { plan: extra.plan } : {}),
      ...(extra.privacy ? { privacy: extra.privacy } : {}),
      ...(extra.intake ? { intake: extra.intake } : {}),
      isSample: true,
    }),
  );
}

/** Every class token in the static markup of the four Part 14 tabs across a spread of states. */
function collectPart14Classes(): Set<string> {
  const used = new Set<string>();
  const keep = (html: string) => {
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const token of (m[1] ?? "").split(/\s+/)) {
        if (token) used.add(token);
      }
    }
  };
  const running = planProgress(planStarted(SAMPLE_PERSON.constraints), {
    type: "stage",
    stage: "gathering",
  });
  const oneRunning = planProgress(running, {
    type: "tool_call",
    id: "1",
    name: "findTwins",
    args: {},
    by: "agent",
  });
  const calls = planProgress(oneRunning, {
    type: "tool_result",
    id: "1",
    name: "findTwins",
    summary: "ok",
    isError: false,
    by: "agent",
    evidenceId: "e1",
  });
  const failedCall = planProgress(
    planProgress(calls, { type: "tool_call", id: "2", name: "compBands", args: {}, by: "engine" }),
    {
      type: "tool_result",
      id: "2",
      name: "compBands",
      summary: "bad argument",
      isError: true,
      by: "engine",
    },
  );
  const unresolved: ClientPlanRun = {
    ...approved,
    status: "unresolved",
    revisions: 2,
    verdicts: [
      {
        approved: false,
        rejections: [
          {
            code: "n_mismatch",
            source: "verifier",
            routeIndex: 0,
            claimText: "Twins took 20 months (n=99)",
            reason: "n does not match the evidence",
          },
        ],
        notes: ["still wrong"],
      },
    ],
  };
  const stale = exploreFor({ maxMonths: 24 });
  const states: [Tab, Parameters<typeof view>[1]][] = [
    ["plan", {}],
    ["plan", { plan: running }],
    ["plan", { plan: oneRunning }],
    ["plan", { plan: failedCall }],
    ["plan", { plan: donePlan }],
    ["plan", { plan: planFinished(planStarted(SAMPLE_PERSON.constraints), unresolved) }],
    ["plan", { plan: planFailed(planStarted(SAMPLE_PERSON.constraints), "The model is busy.") }],
    ["plan", { person: stale.person, plan: donePlan }],
    ["privacy", {}],
    ["privacy", { privacy: { ...IDLE_PRIVACY, ladder: { phase: "done", result: ladder10 } } }],
    [
      "privacy",
      {
        privacy: {
          ...IDLE_PRIVACY,
          settings: { k: 70, companyType: undefined },
          ladder: { phase: "done", result: ladder70 },
        },
      },
    ],
    [
      "privacy",
      {
        privacy: {
          ...IDLE_PRIVACY,
          settings: { k: 10, companyType: "robotics" },
          ladder: { phase: "done", result: ladderRobotics },
        },
      },
    ],
    ["privacy", { privacy: { ...IDLE_PRIVACY, ladder: { phase: "error", error: "The server is down." } } }],
    [
      "privacy",
      {
        privacy: {
          ...IDLE_PRIVACY,
          draft: STORY,
          ladder: { phase: "done", result: ladder10 },
          textCheck: {
            phase: "done",
            result: withText,
            usedModel: true,
            settings: IDLE_PRIVACY.settings,
          },
        },
      },
    ],
    [
      "privacy",
      {
        privacy: {
          ...IDLE_PRIVACY,
          draftProblem: "Paste or type the text you are thinking of sharing.",
          ladder: { phase: "done", result: ladder10 },
          textCheck: { phase: "error", error: "The model is busy." },
        },
      },
    ],
    [
      "privacy",
      {
        privacy: {
          ...IDLE_PRIVACY,
          settings: { k: 20, companyType: undefined },
          ladder: { phase: "done", result: ladder10 },
          textCheck: {
            phase: "done",
            result: withText,
            usedModel: true,
            settings: IDLE_PRIVACY.settings,
          },
        },
      },
    ],
    ["share", {}],
    ["share", { privacy: { ...IDLE_PRIVACY, ladder: { phase: "error", error: "The server is down." } } }],
    ["share", { privacy: { ...IDLE_PRIVACY, ladder: { phase: "done", result: ladder10 } } }],
    [
      "share",
      {
        privacy: {
          ...IDLE_PRIVACY,
          settings: { k: 70, companyType: undefined },
          ladder: { phase: "done", result: ladder70 },
        },
      },
    ],
    ["you", {}],
    ["you", { intake: intakeFor(full) }],
    ["you", { intake: intakeFor(partial) }],
    ["you", { intake: { ...IDLE_INTAKE, phase: "reading", stage: "Removing contact details…" } }],
    ["you", { intake: { ...IDLE_INTAKE, phase: "error", error: "The model is busy." } }],
    [
      "you",
      {
        intake: {
          ...IDLE_INTAKE,
          problem: "Write a few lines about your career, or upload a cropped screenshot.",
          image: { name: "profile.png", dataUrl: "data:image/png;base64,AA" },
        },
      },
    ],
    ["you", { intake: { ...IDLE_INTAKE, confirmProblems: ["Role: choose one."] } }],
  ];
  for (const [tab, extra] of states) keep(view(tab, extra));
  return used;
}

/**
 * Classes the Part 14 tabs render that deliberately have no rule of their own. Each needs a
 * reason; anything else that is rendered but never styled fails the test below and must either
 * gain a style, earn its place here, or be reported.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  app: "root wrapper; layout comes from its children",
  trace: "semantic hook on the trace panel; the card styling comes from .panel",
  share: "semantic hook on the share tab; layout comes from its children",
  ladder__row: "grid item; spacing comes from the .ladder gap",
  privacy__group: "grid item; spacing comes from the .privacy__result gap",
  "trace__status--running": "state hook; the base .trace__status carries the styling",
  "trace__status--ok": "state hook; the base .trace__status carries the styling",
};

const isDefined = (cls: string): boolean => new RegExp("\\." + cls + "(?![\\w-])").test(css);

describe("part-14 stylesheet coverage", () => {
  it("every class the four tabs render is styled, or is on the explicit allowlist", () => {
    const unstyled = [...collectPart14Classes()].filter((cls) => !(cls in ALLOWLIST) && !isDefined(cls));
    expect(unstyled).toEqual([]);
  });

  it("every allowlisted class is still rendered, so the list cannot rot", () => {
    const used = collectPart14Classes();
    for (const cls of Object.keys(ALLOWLIST)) {
      expect(used.has(cls), `${cls} is allowlisted but never rendered`).toBe(true);
    }
  });
});

describe("new sections use only defined variables", () => {
  /** The four Part 14 sections of the stylesheet, from the plan comment to the small-screens one. */
  const sections = css.slice(
    css.indexOf("/* ---------- plan and agent trace ---------- */"),
    css.indexOf("/* ---------- small screens ---------- */"),
  );

  it("every var() used there is defined in :root and in the dark block", () => {
    expect(sections.length).toBeGreaterThan(1000);
    const blocks = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((m) => m[1] ?? "");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const names = new Set([...sections.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1] ?? ""));
    expect(names.size).toBeGreaterThan(5);
    for (const name of names) {
      for (const block of blocks) expect(block.includes(`${name}:`)).toBe(true);
    }
  });

  it("--ok-bg and --ok-fg are defined in both themes", () => {
    const blocks = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((m) => m[1] ?? "");
    for (const block of blocks) {
      expect(block).toContain("--ok-bg:");
      expect(block).toContain("--ok-fg:");
    }
  });
});

describe("readable text on coloured backgrounds", () => {
  it(".plan-stepcard__n uses --on-accent, and nothing hard-codes text colour on --accent", () => {
    const head = /\.plan-stepcard__n\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(head).toContain("background: var(--accent)");
    expect(head).toContain("color: var(--on-accent)");
    const sections = css.slice(
      css.indexOf("/* ---------- plan and agent trace ---------- */"),
      css.indexOf("/* ---------- small screens ---------- */"),
    );
    for (const m of sections.matchAll(/\{([\s\S]*?)\}/g)) {
      const block = m[1] ?? "";
      if (block.includes("background: var(--accent)") && /color\s*:/.test(block)) {
        expect(block).toContain("var(--on-accent)");
      }
    }
  });
});

describe("small screens", () => {
  const narrow = (css.split("@media (max-width: 860px)")[1] ?? "").split("@media")[0] ?? "";

  it("at 860px the privacy settings and the form grid collapse to one column", () => {
    expect(narrow).toMatch(/\.privacy__settings[\s\S]*?grid-template-columns:\s*1fr/);
    expect(narrow).toMatch(/\.form-grid[\s\S]*?grid-template-columns:\s*1fr/);
  });

  it(".tabs scrolls horizontally rather than wrapping or overflowing the page", () => {
    const tabs = /\.tabs\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(tabs).toContain("overflow-x: auto");
    expect(tabs).not.toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("reduced motion", () => {
  it("still disables the trace pulse animation on every element", () => {
    expect(css).toContain("@keyframes pulse");
    const parts = css.split("@media (prefers-reduced-motion: reduce)");
    expect(parts).toHaveLength(2);
    expect(parts[1] ?? "").toContain("animation: none !important");
  });
});

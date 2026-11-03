/**
 * facts.ts: the deterministic evidence core of the route engine.
 *
 * `gatherEvidence` answers: "for this person, goal and constraints, what do the tools say
 * about each archetype?" It is the single source of every number in a plan.
 *
 * It is used two ways:
 *   - Fast path (What-if sliders): call it with a fresh ledger; it runs the tools itself.
 *     No model involved, so it returns in milliseconds.
 *   - Agent path (Planner): the model has already called some tools through the same ledger.
 *     Matching evidence is REUSED, and anything missing is filled in by code. The agent
 *     chooses what to look at, but cannot leave the plan without complete evidence.
 *
 * Reuse is strict: evidence counts only if its arguments equal what this plan needs. An
 * exploratory call made with different arguments stays in the ledger (and can be cited),
 * but never feeds the plan's metrics.
 */
import type { Archetype, Constraints, Goal, Profile, Radar } from "../schemas";
import { stableStringify } from "../stable";
import type { AnyEvidence, EvidenceLedger } from "../tools/ledger";
import type { ToolName } from "../tools/toolSchemas";
import type { PathStatsResult } from "../tools/pathStats";
import { computeRadar } from "./radar";
import { rankRoutes, type Ranking } from "./rank";
import { BANDS } from "../tools/stats";
import type { PathLimits } from "../tools/pathStats";
import type { SkillStatsResult } from "../tools/skillStats";

export const ARCHETYPES: readonly Archetype[] = ["climb", "jump", "pivot"];

/** Everything a plan is computed from. */
export interface EngineInput {
  profile: Profile;
  goal: Goal;
  constraints: Constraints;
}

/** What the cohort says about one skill the person asked about, on one route. */
export interface SkillFacts {
  skill: string;
  evidenceId: string;
  stats: SkillStatsResult;
}

/**
 * The person's own limits as tool arguments. A pay floor that is not a real band is left out
 * rather than guessed at (the interpreter only ever produces real bands).
 */
export function limitsOf(constraints: Partial<Constraints>): PathLimits {
  const limits: PathLimits = {};
  if (constraints.maxMonths !== undefined) limits.maxMonths = constraints.maxMonths;
  const band = BANDS.find((b) => b === constraints.minCompBand);
  if (band !== undefined) limits.minCompBand = band;
  return limits;
}

/** The facts for one route. Every field traces to a ledger evidence record. */
export interface RouteFacts {
  archetype: Archetype;
  /** Evidence id of the pathStats call this route's numbers come from. */
  statsEvidenceId: string;
  /** Evidence id of the compBands call for the goal level in the user's region. */
  compEvidenceId: string;
  n: number;
  evidenceThin: boolean;
  /** P25 to P75 months among twins who reached the goal; null when none did. */
  monthsToGoal: [number, number] | null;
  /** 95% interval for the share of twins who reached the goal. */
  reachedRate: [number, number];
  compBandRange: [string, string];
  topRisks: string[];
  topGates: string[];
  topCompanyTypes: string[];
  radar: Radar;
  /** The full pathStats result, kept for diffing and explanations. */
  stats: PathStatsResult;
  /** One entry per skill the person asked about (constraints.addSkills), in the order asked. */
  skills: SkillFacts[];
}

/** All facts for a plan, plus the bookkeeping the trace and verifier need. */
export interface FactSheet {
  input: EngineInput;
  twins: { evidenceId: string; n: number };
  compEvidenceId: string;
  routes: RouteFacts[];
  /** Which route to look at first, given the person's risk tolerance. */
  ranking: Ranking;
  /** Twins across all archetypes who did not reach the goal: the survivorship-bias caveat. */
  survivorship: { totalTwins: number; notReachedShare: number };
  /** Tools this call had to run itself because the agent had not (empty on the fast path only if reused). */
  filledIn: string[];
}

/** True when at least one limit is set. */
const hasLimits = (limits: PathLimits): boolean => Object.keys(limits).length > 0;

/** Only these constraint knobs change who counts as a twin. Others do not affect findTwins. */
function twinKnobs(constraints: Partial<Constraints>): { remote: boolean; noRelocation: boolean } {
  return { remote: Boolean(constraints.remote), noRelocation: Boolean(constraints.noRelocation) };
}

/** The recorded-evidence type for one tool, e.g. EvidenceOf<"pathStats">. */
type EvidenceOf<N extends ToolName> = Extract<AnyEvidence, { tool: N }>;

/** Find the earliest recorded evidence of one tool that satisfies a predicate. */
function findEvidence<N extends ToolName>(
  ledger: EvidenceLedger,
  tool: N,
  matches: (evidence: EvidenceOf<N>) => boolean,
): EvidenceOf<N> | undefined {
  for (const evidence of ledger.all()) {
    if (evidence.tool !== tool) continue;
    // Safe: the runtime check above guarantees this record came from `tool`, but
    // TypeScript cannot narrow a union through a generic tool name.
    const typed = evidence as EvidenceOf<N>;
    if (matches(typed)) return typed;
  }
  return undefined;
}

/**
 * Gather (or reuse) all evidence a plan needs, and compute the per-route facts.
 *
 * @param ledger session ledger; every tool call is recorded here
 * @param input  profile, goal and constraints
 */
export function gatherEvidence(ledger: EvidenceLedger, input: EngineInput): FactSheet {
  const { profile, goal, constraints } = input;
  const filledIn: string[] = [];

  // 1. Twins: reuse a matching findTwins call, else run it.
  const wantedKnobs = stableStringify(twinKnobs(constraints));
  let twins = findEvidence(
    ledger,
    "findTwins",
    (e) =>
      stableStringify(e.args.profile) === stableStringify(profile) &&
      stableStringify(e.args.goal) === stableStringify(goal) &&
      stableStringify(twinKnobs(e.args.constraints ?? {})) === wantedKnobs,
  );
  if (!twins) {
    twins = ledger.call("findTwins", { profile, goal, constraints });
    filledIn.push("findTwins");
  }
  const twinIds = twins.result.twinIds;
  const limits = limitsOf(constraints);
  const limitsKey = stableStringify(limits);

  // 2. Comp bands for the goal level in the user's region.
  let comp = findEvidence(
    ledger,
    "compBands",
    (e) => e.args.level === goal.targetLevel && e.args.region === profile.region,
  );
  if (!comp) {
    comp = ledger.call("compBands", { level: goal.targetLevel, region: profile.region });
    filledIn.push("compBands");
  }

  // 3. One pathStats per archetype over exactly this twin set.
  const routes = ARCHETYPES.map((archetype): RouteFacts => {
    let stats = findEvidence(
      ledger,
      "pathStats",
      (e) =>
        e.args.archetype === archetype &&
        stableStringify(e.args.twinIds) === stableStringify(twinIds) &&
        stableStringify(e.args.limits ?? {}) === limitsKey,
    );
    if (!stats) {
      stats = ledger.call("pathStats", { twinIds, archetype, ...(hasLimits(limits) ? { limits } : {}) });
      filledIn.push(`pathStats:${archetype}`);
    }
    const result = stats.result;
    const skills = constraints.addSkills.map((skill): SkillFacts => {
      let found = findEvidence(
        ledger,
        "skillStats",
        (e) =>
          e.args.archetype === archetype &&
          e.args.skill === skill &&
          stableStringify(e.args.twinIds) === stableStringify(twinIds) &&
          stableStringify(e.args.limits ?? {}) === limitsKey,
      );
      if (!found) {
        found = ledger.call("skillStats", {
          twinIds,
          archetype,
          skill,
          ...(hasLimits(limits) ? { limits } : {}),
        });
        filledIn.push(`skillStats:${archetype}:${skill}`);
      }
      return { skill, evidenceId: found.evidenceId, stats: found.result };
    });
    return {
      archetype,
      statsEvidenceId: stats.evidenceId,
      compEvidenceId: comp.evidenceId,
      n: result.n,
      evidenceThin: result.evidenceThin,
      monthsToGoal:
        result.monthsP25 !== null && result.monthsP75 !== null ? [result.monthsP25, result.monthsP75] : null,
      reachedRate: result.reachedRate,
      compBandRange: result.compBandRange,
      topRisks: result.topRisks,
      topGates: result.topGates,
      topCompanyTypes: result.topCompanyTypes,
      radar: computeRadar(result),
      stats: result,
      skills,
    };
  });

  const totalTwins = routes.reduce((sum, route) => sum + route.n, 0);
  // Survivorship counts who NEVER reached the goal (stalled or left the field). Under the person's limits,
  // "reached" excludes people who reached it late, so use the cohort's own outcome, not the limited one.
  const reachedTotal = routes.reduce(
    (sum, route) => sum + route.n * route.stats.ignoringLimits.reachedShare,
    0,
  );
  return {
    input,
    twins: { evidenceId: twins.evidenceId, n: twins.result.n },
    compEvidenceId: comp.evidenceId,
    routes,
    ranking: rankRoutes(routes, constraints.riskTolerance),
    survivorship: {
      totalTwins,
      notReachedShare: totalTwins === 0 ? 0 : Math.round((1 - reachedTotal / totalTwins) * 100) / 100,
    },
    filledIn,
  };
}

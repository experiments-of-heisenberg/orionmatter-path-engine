import { writeFileSync } from "node:fs";
import type { CohortRecord } from "../src/lib/schemas";

// mulberry32 seeded RNG, reproducible
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seed = Number(process.env.COHORT_SEED ?? 1026);
const r = rng(seed);
/** Pick a random element; throws on an empty list so callers never get `undefined`. */
const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(r() * items.length)];
  if (item === undefined) throw new Error("pick() called with an empty list");
  return item;
};
const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));

/** Role families come from the schema so the generator can never drift from it. */
type Role = CohortRecord["roleFamily"];
const regions = ["IN-south", "EU-west", "US-west", "US-east", "SEA"];
const companyTypes = ["seriesB-fintech", "bigtech", "growth-infra", "robotics", "seriesC-fintech"];
const skills = ["distributed-systems", "kubernetes", "system-design", "rust", "ml-ops", "cross-team-lead"];
const bands = ["B1", "B2", "B3", "B4", "B5"] as const;
/** Band label for an index, clamped to the valid range. */
const bandAt = (i: number): string => bands[Math.min(bands.length - 1, Math.max(0, i))] as string;

// archetype profiles: [months lo, hi], comp uplift, success rate
const prof = {
  climb: { m: [30, 44], uplift: 1, success: 0.8, steps: 1 },
  jump: { m: [14, 26], uplift: 2, success: 0.72, steps: 2 },
  pivot: { m: [36, 54], uplift: 2, success: 0.66, steps: 3 },
} as const;

const out: CohortRecord[] = [];
let i = 1;
function add(n: number, role: Role, arche: keyof typeof prof, goalLevel: CohortRecord["endLevel"]) {
  for (let k = 0; k < n; k++) {
    const p = prof[arche];
    const startBand = between(0, 2);
    const roll = r();
    const outcome = roll < p.success ? "reached" : roll < p.success + 0.12 ? "stalled" : "left-field";
    const months = outcome === "reached" ? between(p.m[0], p.m[1]) : between(p.m[1], p.m[1] + 14);
    out.push({
      id: `syn_${String(i++).padStart(4, "0")}`,
      synthetic: true,
      roleFamily: role,
      startLevel: pick(["L4", "L5"] as const),
      endLevel: goalLevel,
      archetype: arche,
      companyTypeSteps: Array.from({ length: p.steps }, () => pick(companyTypes)),
      months,
      compBandStart: bandAt(startBand),
      compBandEnd: bandAt(startBand + p.uplift + (outcome === "reached" ? 1 : 0)),
      remote: r() < 0.5,
      skillsProven: Array.from(new Set([pick(skills), pick(skills)])),
      outcome,
      region: pick(regions),
    });
  }
}
// Backend/platform: healthy cohorts for all archetypes
for (const role of ["backend", "platform"] as const) {
  add(55, role, "climb", "L6");
  add(65, role, "jump", "L6");
  add(30, role, "pivot", "L6");
}
// ML pivot: thin on purpose (n<15) so the Skeptic can catch overclaims
add(9, "ml", "pivot", "L6");
add(24, "ml", "jump", "L6");
add(20, "ml", "climb", "L6");
// misc roles + EM goal
for (const role of ["sre", "frontend", "embedded"] as const) {
  add(14, role, "climb", "L6");
  add(12, role, "jump", "L6");
}
add(25, "backend", "climb", "EM1");
add(22, "backend", "jump", "EM1");
// thin pivot segment for embedded
add(6, "embedded", "pivot", "L6");

writeFileSync("data/cohort.synthetic.json", JSON.stringify({ synthetic: true, seed, records: out }, null, 1));
const nonReached = out.filter((o) => o.outcome !== "reached").length;
console.log(
  `generated ${out.length} synthetic records, ${((100 * nonReached) / out.length).toFixed(1)}% non-reached (seed ${seed})`,
);

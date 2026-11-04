/** Evidence-id edges: many distinct calls, key order, long id lists, replay and unknown keys. */
import { describe, expect, it } from "vitest";
import { gatherEvidence, type EngineInput } from "../src/lib/engine";
import { Constraints } from "../src/lib/schemas";
import { EvidenceLedger } from "../src/lib/tools/ledger";
import { goal, input, profile } from "./helpers/fixturesData";

const BANDS = ["B1", "B2", "B3", "B4", "B5"] as const;
const RISKS = ["low", "medium", "high"] as const;

describe("evidence id edges", () => {
  it("200 different findTwins constraint combinations all get distinct ids", () => {
    const ledger = new EvidenceLedger();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const constraints = Constraints.parse({
        remote: i % 2 === 0,
        noRelocation: i % 3 === 0,
        minCompBand: BANDS[i % 5],
        maxMonths: (i % 200) + 1,
        riskTolerance: RISKS[i % 3],
        addSkills: i % 2 === 0 ? [] : ["rust"],
      });
      ids.add(ledger.call("findTwins", { profile, goal, constraints }).evidenceId);
    }
    expect(ids.size).toBe(200);
  });

  it("the same arguments in a different key order give the same id: keys are sorted before hashing", () => {
    const constraints = Constraints.parse({});
    const first = new EvidenceLedger().call("findTwins", { profile, goal, constraints });
    const second = new EvidenceLedger().call("findTwins", { constraints, goal, profile });
    expect(second.evidenceId).toBe(first.evidenceId);
  });

  it("ids for pathStats calls with 150 twin ids are ev_ plus 8 hex digits", () => {
    const ledger = new EvidenceLedger();
    const twins = ledger.call("findTwins", { profile, goal, constraints: Constraints.parse({}) });
    expect(twins.result.n).toBeGreaterThanOrEqual(150);
    const stats = ledger.call("pathStats", {
      twinIds: twins.result.twinIds.slice(0, 150),
      archetype: "climb",
    });
    expect(stats.evidenceId).toMatch(/^ev_[0-9a-f]{8}$/);
  });

  it("a ledger replay: gatherEvidence twice in two ledgers gives equal evidence id lists", () => {
    const run = (engineInput: EngineInput): string[] => {
      const ledger = new EvidenceLedger();
      gatherEvidence(ledger, engineInput);
      return ledger.all().map((e) => e.evidenceId);
    };
    const first = run(input);
    expect(first.length).toBeGreaterThan(0);
    expect(run(input)).toEqual(first);
  });

  it("a model-supplied call with extra unknown keys is accepted with keys stripped, and consumes an id", () => {
    // The tool schemas are not .strict(), so Zod's default applies: unknown keys are dropped and the
    // call succeeds. The stripped call hashes exactly like one sent without the keys.
    const constraints = Constraints.parse({});
    const clean = new EvidenceLedger().call("findTwins", { profile, goal, constraints });
    const ledger = new EvidenceLedger();
    const result = ledger.callUntrusted("findTwins", { profile, goal, constraints, bogus: "junk" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.evidenceId).toBe(clean.evidenceId);
    expect(ledger.all()).toHaveLength(1);
  });
});

/**
 * Tests for the evidence ledger. The focus is the untrusted path: the model will
 * supply tool names and arguments, so bad input must be rejected with a useful
 * message and must never reach a tool.
 */
import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../src/lib/tools";
import { Profile } from "../src/lib/schemas";

const profile = Profile.parse({
  roleFamily: "backend",
  level: "L5",
  yearsExperience: 7,
  stack: ["go"],
  region: "IN-south",
});
const goal = { targetLevel: "L6", label: "Staff" };

describe("EvidenceLedger (trusted calls)", () => {
  it("records the call and returns it with its citation id", () => {
    const ledger = new EvidenceLedger({ newId: () => "ev_fixed" });
    const evidence = ledger.call("levelMap", { company: "BigTech A", title: "SDE II" });
    expect(evidence.evidenceId).toBe("ev_fixed");
    expect(evidence.result.canonicalLevel).toBe("L4");
    expect(ledger.has("ev_fixed")).toBe(true);
    expect(ledger.get("ev_fixed")?.tool).toBe("levelMap");
  });

  it("never reuses an id, even if the generator repeats itself", () => {
    const ids = ["ev_a", "ev_a", "ev_b"];
    const ledger = new EvidenceLedger({ newId: () => ids.shift() ?? "ev_z" });
    const first = ledger.call("levelMap", { company: "BigTech A", title: "SDE II" });
    const second = ledger.call("levelMap", { company: "BigTech A", title: "SDE I" });
    expect([first.evidenceId, second.evidenceId]).toEqual(["ev_a", "ev_b"]);
  });

  it("reports unknown ids as absent", () => {
    expect(new EvidenceLedger().has("ev_nope")).toBe(false);
  });
});

describe("EvidenceLedger (untrusted calls from the model)", () => {
  it("accepts a valid call and records it", () => {
    const ledger = new EvidenceLedger();
    const outcome = ledger.callUntrusted("findTwins", { profile, goal });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.evidence.tool).toBe("findTwins");
      expect(ledger.has(outcome.evidence.evidenceId)).toBe(true);
    }
  });

  it("rejects an unknown tool name without recording anything", () => {
    const ledger = new EvidenceLedger();
    const outcome = ledger.callUntrusted("deleteEverything", {});
    expect(outcome).toEqual({ ok: false, error: 'Unknown tool "deleteEverything".' });
    expect(ledger.all()).toHaveLength(0);
  });

  it("rejects arguments that fail the schema, with a readable message", () => {
    const ledger = new EvidenceLedger();
    const outcome = ledger.callUntrusted("pathStats", { twinIds: "not-an-array", archetype: "jump" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Invalid arguments for pathStats");
    expect(ledger.all()).toHaveLength(0);
  });

  it("rejects an archetype outside the allowed set", () => {
    const outcome = new EvidenceLedger().callUntrusted("pathStats", { twinIds: [], archetype: "teleport" });
    expect(outcome.ok).toBe(false);
  });

  it("caps oversized id lists so a bad model cannot send a huge payload", () => {
    const twinIds = Array.from({ length: 2001 }, (_, i) => `syn_${i}`);
    expect(new EvidenceLedger().callUntrusted("pathStats", { twinIds, archetype: "jump" }).ok).toBe(false);
  });
});

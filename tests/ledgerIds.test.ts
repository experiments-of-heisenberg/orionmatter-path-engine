/** Evidence ids come from the call's content, so a run can be repeated exactly; they are still hard to guess. */
import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../src/lib/tools/ledger";
import { goal, profile } from "./helpers/fixturesData";
import { Constraints } from "../src/lib/schemas";

const constraints = Constraints.parse({});
const find = (ledger: EvidenceLedger, over: object = {}) =>
  ledger.call("findTwins", { profile, goal, constraints: Constraints.parse({ ...constraints, ...over }) });

describe("default evidence ids", () => {
  it("are the same in two separate ledgers for the same call, so a recorded run replays", () => {
    expect(find(new EvidenceLedger()).evidenceId).toBe(find(new EvidenceLedger()).evidenceId);
  });
  it("look like ev_ and 8 hex digits, and differ when the arguments differ", () => {
    const ledger = new EvidenceLedger();
    const a = find(ledger).evidenceId;
    const b = find(ledger, { remote: true }).evidenceId;
    expect(a).toMatch(/^ev_[0-9a-f]{8}$/);
    expect(b).toMatch(/^ev_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
  it("depend on the tool as well as the arguments", () => {
    const ledger = new EvidenceLedger();
    const twins = find(ledger);
    const comp = ledger.call("compBands", { level: "L6", region: "IN-south" });
    expect(comp.evidenceId).not.toBe(twins.evidenceId);
  });
  it("give a repeat of the very same call its own record, with a suffix", () => {
    const ledger = new EvidenceLedger();
    const first = find(ledger);
    const second = find(ledger);
    const third = find(ledger);
    expect(second.evidenceId).toBe(`${first.evidenceId}_2`);
    expect(third.evidenceId).toBe(`${first.evidenceId}_3`);
    expect(ledger.all()).toHaveLength(3);
    expect(ledger.get(second.evidenceId)).toBe(second);
  });
  it("a model-supplied call gets the same id as a trusted one with the same arguments", () => {
    const trusted = find(new EvidenceLedger());
    const untrusted = new EvidenceLedger().callUntrusted("findTwins", { profile, goal, constraints });
    expect(untrusted.ok && untrusted.evidence.evidenceId).toBe(trusted.evidenceId);
  });
  it("an injected generator still wins, for tests that want their own ids", () => {
    const ledger = new EvidenceLedger({ newId: () => "ev_mine" });
    expect(find(ledger).evidenceId).toBe("ev_mine");
  });
  it("a lookup the model never made cannot be named by guessing: sequential ids do not exist", () => {
    const ledger = new EvidenceLedger();
    find(ledger);
    for (const guess of ["ev_1", "ev_2", "ev_0", "ev_00000000"]) expect(ledger.has(guess)).toBe(false);
  });
});

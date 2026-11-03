import { randomBytes } from "node:crypto";
import { findTwins } from "./findTwins";
import { pathStats } from "./pathStats";
import { levelMap } from "./levelMap";
import { compBands } from "./compBands";
import { kAnonymity } from "./kAnonymity";

export { findTwins, pathStats, levelMap, compBands, kAnonymity };

export type EvidenceRecord = { evidenceId: string; tool: string; args: unknown; result: any };

/** Per-session evidence ledger. Every tool call is recorded with a unique evidenceId; claims must cite these. */
export class EvidenceLedger {
  records = new Map<string, EvidenceRecord>();
  call(tool: "findTwins" | "pathStats" | "levelMap" | "compBands", args: any) {
    const result = (this.run(tool, args) as any);
    const evidenceId = "ev_" + randomBytes(3).toString("hex");
    this.records.set(evidenceId, { evidenceId, tool, args, result });
    return { evidenceId, ...result };
  }
  private run(tool: string, a: any) {
    switch (tool) {
      case "findTwins": return findTwins(a.profile, a.goal, a.constraints);
      case "pathStats": return pathStats(a.twinIds, a.archetype);
      case "levelMap": return levelMap(a.company, a.title);
      case "compBands": return compBands(a.level, a.region);
      default: throw new Error(`Unknown tool: ${tool}`);
    }
  }
}

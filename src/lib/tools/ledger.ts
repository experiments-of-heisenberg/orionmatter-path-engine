/**
 * ledger.ts: the per-session evidence ledger.
 *
 * Every tool call made during a planning session is recorded here under a unique
 * `evidenceId`. The Planner must cite these ids in its claims, and the Skeptic's
 * deterministic verifier rejects any claim whose id is not in the ledger or whose
 * numbers do not match the recorded result. This is what makes "every number traces
 * to a tool, not to model memory" enforceable by code rather than by trust.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { compBands } from "./compBands";
import { findTwins } from "./findTwins";
import { levelMap } from "./levelMap";
import { pathStats } from "./pathStats";
import { isToolName, ToolArgSchemas, type ToolArgs, type ToolName } from "./toolSchemas";

/** Result type of each tool, derived from the tool functions themselves. */
export interface ToolResults {
  findTwins: ReturnType<typeof findTwins>;
  pathStats: ReturnType<typeof pathStats>;
  levelMap: ReturnType<typeof levelMap>;
  compBands: ReturnType<typeof compBands>;
}

/** One recorded tool call: what was asked, what came back, and its citation id. */
export interface Evidence<N extends ToolName = ToolName> {
  evidenceId: string;
  tool: N;
  args: ToolArgs<N>;
  result: ToolResults[N];
}

/** Any recorded evidence, regardless of which tool produced it. */
export type AnyEvidence = { [N in ToolName]: Evidence<N> }[ToolName];

/** Outcome of a tool call that originated from untrusted (model-supplied) input. */
export type UntrustedCallResult = { ok: true; evidence: AnyEvidence } | { ok: false; error: string };

/** Maps each tool name to its implementation, checked against the schema-derived types. */
const HANDLERS: { [N in ToolName]: (args: ToolArgs<N>) => ToolResults[N] } = {
  findTwins: (a) => findTwins(a.profile, a.goal, a.constraints),
  pathStats: (a) => pathStats(a.twinIds, a.archetype),
  levelMap: (a) => levelMap(a.company, a.title),
  compBands: (a) => compBands(a.level, a.region),
};

export interface LedgerOptions {
  /** Id generator; injectable so tests can produce deterministic evidence ids. */
  newId?: () => string;
}

/** Default id: "ev_" plus 8 hex chars of randomness. */
const defaultNewId = () => `ev_${randomBytes(4).toString("hex")}`;

export class EvidenceLedger {
  private readonly records = new Map<string, AnyEvidence>();
  private readonly newId: () => string;

  constructor(options: LedgerOptions = {}) {
    this.newId = options.newId ?? defaultNewId;
  }

  /**
   * Call a tool with already-typed arguments and record the result.
   * Use this from trusted code. For model-supplied calls use {@link callUntrusted}.
   */
  call<N extends ToolName>(tool: N, args: ToolArgs<N>): Evidence<N> {
    const result = HANDLERS[tool](args);
    const evidence = { evidenceId: this.uniqueId(), tool, args, result } as Evidence<N>;
    this.records.set(evidence.evidenceId, evidence as AnyEvidence);
    return evidence;
  }

  /**
   * Call a tool using a name and arguments that came from the model.
   * Nothing is trusted: the tool name must exist and the arguments must pass the
   * tool's Zod schema. Failures are returned (not thrown) so the Planner loop can
   * feed the error back to the model and let it correct itself.
   */
  callUntrusted(toolName: string, rawArgs: unknown): UntrustedCallResult {
    if (!isToolName(toolName)) {
      return { ok: false, error: `Unknown tool "${toolName}".` };
    }
    return this.validateAndCall(toolName, rawArgs);
  }

  /** Validate raw args against the named tool's schema, then run it. */
  private validateAndCall<N extends ToolName>(toolName: N, rawArgs: unknown): UntrustedCallResult {
    const parsed = ToolArgSchemas[toolName].safeParse(rawArgs);
    if (!parsed.success) {
      return { ok: false, error: `Invalid arguments for ${toolName}: ${z.prettifyError(parsed.error)}` };
    }
    // The schema lookup above is keyed by the generic N, so TypeScript widens the parsed
    // data; the cast restores the exact type that this schema just validated.
    const evidence = this.call(toolName, parsed.data as ToolArgs<N>);
    return { ok: true, evidence: evidence as AnyEvidence };
  }

  /** Look up recorded evidence by id (undefined when the id was never issued). */
  get(evidenceId: string): AnyEvidence | undefined {
    return this.records.get(evidenceId);
  }

  /** True when the id exists in this session. The verifier's first check. */
  has(evidenceId: string): boolean {
    return this.records.has(evidenceId);
  }

  /** All evidence recorded so far, in call order. */
  all(): AnyEvidence[] {
    return [...this.records.values()];
  }

  /** Generate an id that is guaranteed not to collide within this ledger. */
  private uniqueId(): string {
    let id = this.newId();
    while (this.records.has(id)) id = this.newId();
    return id;
  }
}

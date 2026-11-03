/**
 * events.ts: what agents report while they work.
 *
 * Agents emit these as they go; the API layer (Part 11) streams them to the browser as
 * Server-Sent Events, and the Agent Trace panel renders them. Keeping them as plain data
 * means the same events can drive a UI, a log or a test assertion.
 */

import type { Rejection } from "../schemas";

/** Who made a tool call: the model (agent) or deterministic code filling a gap (engine). */
export type CallSource = "agent" | "engine";

export type AgentEvent =
  | {
      type: "stage";
      stage:
        | "reading"
        | "protecting"
        | "interpreting"
        | "explaining"
        | "gathering"
        | "composing"
        | "auditing"
        | "revising"
        | "done";
      round?: number;
    }
  | { type: "tool_call"; id: string; name: string; args: unknown; by: CallSource }
  | {
      type: "tool_result";
      id: string;
      name: string;
      summary: string;
      isError: boolean;
      by: CallSource;
      /** Ledger evidence id, present when the call succeeded. Claims cite these. */
      evidenceId?: string;
    }
  | { type: "note"; message: string }
  /** The Skeptic's verdict after an audit round (round 0 is the first plan). */
  | { type: "verdict"; round: number; approved: boolean; rejections: Rejection[]; notes: string[] };

/** Callback agents use to report progress. */
export type Emit = (event: AgentEvent) => void;

/** An emitter that discards events. */
export const noEmit: Emit = () => undefined;

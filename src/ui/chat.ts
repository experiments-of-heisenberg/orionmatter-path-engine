/**
 * chat.ts: the What-if conversation as plain data.
 *
 * The chat box sends one sentence to /api/whatif and gets back what was understood, what was refused,
 * a question if something was too vague, and a short explanation. This module holds the parts of that
 * conversation that are logic rather than layout: checking a message before sending, the list of turns and
 * how each one changes as the stream reports progress, the words for each stage, and how a reply to a
 * clarifying question is sent. Everything is pure so it is tested without React or a network.
 */
import type { AgentEvent } from "../lib/agents";
import type { WhatIfResult } from "../lib/api/handlers";
import type { Constraints } from "../lib/schemas";

/** Longest message the server accepts. Kept in step with the server's own limit by a test. */
export const MAX_MESSAGE = 500;

export type TurnStatus = "working" | "done" | "error";

/** One message from the person and everything that came back. */
export interface Turn {
  id: number;
  message: string;
  status: TurnStatus;
  /** What the agents are doing right now, in words, while `working`. */
  stage?: string;
  result?: WhatIfResult;
  error?: string;
}

/** Check a message before it is sent, returning the cleaned text or what is wrong in words. */
export function checkMessage(raw: string): { ok: true; text: string } | { ok: false; message: string } {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (text === "")
    return {
      ok: false,
      message: "Type what you would like to change, for example \u201cwhat if I won\u2019t relocate?\u201d",
    };
  if (text.length > MAX_MESSAGE) {
    return { ok: false, message: `That is ${text.length} characters. Please keep it under ${MAX_MESSAGE}.` };
  }
  return { ok: true, text };
}

/** The words shown for each stage the stream reports. Stages that do not belong to a What-if turn show nothing. */
export function stageLabel(event: AgentEvent): string | undefined {
  if (event.type !== "stage") return undefined;
  switch (event.stage) {
    case "interpreting":
      return "Understanding what you asked\u2026";
    case "gathering":
      return "Recomputing the routes\u2026";
    case "explaining":
      return "Writing the explanation\u2026";
    default:
      return undefined;
  }
}

/** Add a message as a working turn. */
export function startTurn(turns: readonly Turn[], message: string): { turns: Turn[]; id: number } {
  const id = turns.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  return {
    turns: [...turns, { id, message, status: "working", stage: "Understanding what you asked\u2026" }],
    id,
  };
}

/** Update a working turn's stage label. Ignored for events with no label. */
export function progressTurn(turns: readonly Turn[], id: number, event: AgentEvent): Turn[] {
  const stage = stageLabel(event);
  if (stage === undefined) return [...turns];
  return turns.map((t) => (t.id === id && t.status === "working" ? { ...t, stage } : t));
}

/** Finish a turn with its result. */
export function finishTurn(turns: readonly Turn[], id: number, result: WhatIfResult): Turn[] {
  return turns.map((t) => {
    if (t.id !== id) return t;
    const { stage: _stage, ...rest } = t;
    return { ...rest, status: "done", result };
  });
}

/** Finish a turn with an error message. */
export function failTurn(turns: readonly Turn[], id: number, error: string): Turn[] {
  return turns.map((t) => {
    if (t.id !== id) return t;
    const { stage: _stage, ...rest } = t;
    return { ...rest, status: "error", error };
  });
}

/** The question the last finished turn asked, if the person has not answered it yet. */
export function pendingQuestion(turns: readonly Turn[]): { question: string; options: string[] } | null {
  const last = turns[turns.length - 1];
  const clarification = last?.status === "done" ? last.result?.interpretation.clarification : undefined;
  if (!clarification) return null;
  return { question: clarification.question, options: clarification.options ?? [] };
}

/** What to send for the next message: a reply to an open question carries that question as history. */
export function requestFor(
  turns: readonly Turn[],
  text: string,
  current: Constraints,
): { message: string; current: Constraints; history?: { question: string; answer: string }[] } {
  const open = pendingQuestion(turns);
  if (!open) return { message: text, current };
  return {
    message: text,
    current,
    history: [{ question: open.question.slice(0, 400), answer: text.slice(0, 600) }],
  };
}

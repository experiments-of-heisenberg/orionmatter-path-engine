/** The What-if conversation as data: validation, stage words, turn transitions, and replying to a question. */
import { describe, expect, it } from "vitest";
import type { WhatIfResult } from "../src/lib/api/handlers";
import { MAX_MESSAGE_CHARS } from "../src/lib/whatif";
import {
  MAX_MESSAGE,
  checkMessage,
  failTurn,
  finishTurn,
  pendingQuestion,
  progressTurn,
  requestFor,
  stageLabel,
  startTurn,
  type Turn,
} from "../src/ui/chat";
import { SAMPLE_PERSON } from "../src/ui/sample";

const base = SAMPLE_PERSON.constraints;
const resultWith = (clarification?: { question: string; options?: string[] }): WhatIfResult =>
  ({
    interpretation: {
      status: "applied",
      next: base,
      applied: [],
      refused: [],
      unsupported: [],
      conflicts: [],
      notes: [],
      ...(clarification ? { clarification: { about: "other", ...clarification } } : {}),
    },
  }) as unknown as WhatIfResult;

describe("checkMessage", () => {
  it("keeps the server's limit in step with the screen's", () => {
    expect(MAX_MESSAGE).toBe(MAX_MESSAGE_CHARS);
  });
  it("trims, strips control characters, and returns the text", () => {
    expect(checkMessage("  what if I stay?  ")).toEqual({ ok: true, text: "what if I stay?" });
    expect(checkMessage("a\u0000b\u0007c")).toEqual({ ok: true, text: "abc" });
    expect(checkMessage("line one\nline two")).toEqual({ ok: true, text: "line one\nline two" });
  });
  it("explains an empty message, and a message of only control characters", () => {
    for (const raw of ["", "   ", "\u0000\u0001"]) {
      const result = checkMessage(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Type what you would like to change");
    }
  });
  it("accepts exactly the limit and refuses one more, with the count", () => {
    expect(checkMessage("x".repeat(MAX_MESSAGE)).ok).toBe(true);
    const over = checkMessage("x".repeat(MAX_MESSAGE + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain(`${MAX_MESSAGE + 1} characters`);
  });
});

describe("stageLabel", () => {
  it("words the three stages of a What-if turn and ignores everything else", () => {
    expect(stageLabel({ type: "stage", stage: "interpreting" })).toBe("Understanding what you asked\u2026");
    expect(stageLabel({ type: "stage", stage: "gathering" })).toBe("Recomputing the routes\u2026");
    expect(stageLabel({ type: "stage", stage: "explaining" })).toBe("Writing the explanation\u2026");
    expect(stageLabel({ type: "stage", stage: "auditing" })).toBeUndefined();
    expect(stageLabel({ type: "note", message: "hi" })).toBeUndefined();
  });
});

describe("turns", () => {
  it("numbers turns from one and starts them working", () => {
    const a = startTurn([], "one");
    expect(a.id).toBe(1);
    expect(a.turns[0]).toMatchObject({ message: "one", status: "working" });
    expect(startTurn(a.turns, "two").id).toBe(2);
  });
  it("progress changes only the working turn it names, and ignores unlabelled events", () => {
    const a = startTurn([], "one");
    const b = startTurn(a.turns, "two");
    const next = progressTurn(b.turns, 2, { type: "stage", stage: "explaining" });
    expect(next[1]?.stage).toBe("Writing the explanation\u2026");
    expect(next[0]?.stage).toBe("Understanding what you asked\u2026");
    expect(progressTurn(b.turns, 2, { type: "note", message: "x" })).toEqual(b.turns);
  });
  it("progress does not reopen a finished turn", () => {
    const a = startTurn([], "one");
    const done = finishTurn(a.turns, 1, resultWith());
    expect(progressTurn(done, 1, { type: "stage", stage: "explaining" })).toEqual(done);
  });
  it("finishing and failing drop the stage and set the outcome", () => {
    const a = startTurn([], "one");
    const done = finishTurn(a.turns, 1, resultWith());
    expect(done[0]?.status).toBe("done");
    expect("stage" in (done[0] as Turn)).toBe(false);
    const failed = failTurn(a.turns, 1, "The model is busy.");
    expect(failed[0]).toMatchObject({ status: "error", error: "The model is busy." });
    expect("stage" in (failed[0] as Turn)).toBe(false);
  });
});

describe("a reply to a question", () => {
  const asked = (): Turn[] =>
    finishTurn(
      startTurn([], "more money").turns,
      1,
      resultWith({ question: "Which band?", options: ["B3", "B4"] }),
    );
  it("is pending only for the last finished turn", () => {
    expect(pendingQuestion([])).toBeNull();
    expect(pendingQuestion(asked())).toEqual({ question: "Which band?", options: ["B3", "B4"] });
    expect(pendingQuestion(startTurn(asked(), "B4").turns)).toBeNull();
    expect(pendingQuestion(failTurn(startTurn([], "x").turns, 1, "bad"))).toBeNull();
  });
  it("has no options when the model gave none", () => {
    const turns = finishTurn(startTurn([], "x").turns, 1, resultWith({ question: "Which?" }));
    expect(pendingQuestion(turns)).toEqual({ question: "Which?", options: [] });
  });
  it("is sent with the question as history; a fresh message carries none", () => {
    expect(requestFor([], "hello", base)).toEqual({ message: "hello", current: base });
    expect(requestFor(asked(), "B4", base)).toEqual({
      message: "B4",
      current: base,
      history: [{ question: "Which band?", answer: "B4" }],
    });
  });
  it("cuts a long question and a long answer to what the API accepts", () => {
    const turns = finishTurn(startTurn([], "x").turns, 1, resultWith({ question: "q".repeat(500) }));
    const req = requestFor(turns, "a".repeat(700), base);
    expect(req.history?.[0]?.question).toHaveLength(400);
    expect(req.history?.[0]?.answer).toHaveLength(600);
  });
});

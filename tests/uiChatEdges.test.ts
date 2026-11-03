/** Edge cases for the chat logic: hostile message text, a stale question, unknown turn ids, and gappy numbering. */
import { describe, expect, it } from "vitest";
import type { WhatIfResult } from "../src/lib/api/handlers";
import {
  checkMessage,
  failTurn,
  finishTurn,
  holdTurn,
  progressTurn,
  releaseTurn,
  requestFor,
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

describe("checkMessage with hostile text", () => {
  it("accepts an emoji-only message", () => {
    expect(checkMessage("🎉")).toEqual({ ok: true, text: "🎉" });
  });

  it("counts length in UTF-16 units: 250 emoji are 500 characters", () => {
    // String.length counts code units, so an emoji counts as two. The server measures the same
    // way (message.length), so the two limits agree even for non-BMP text.
    expect(checkMessage("😀".repeat(250))).toEqual({ ok: true, text: "😀".repeat(250) });
    expect(checkMessage("😀".repeat(251)).ok).toBe(false);
  });

  it("keeps carriage returns and newlines", () => {
    expect(checkMessage("a\r\nb")).toEqual({ ok: true, text: "a\r\nb" });
  });

  it("lets a lone surrogate through (only control characters are stripped)", () => {
    expect(checkMessage("\ud800")).toEqual({ ok: true, text: "\ud800" });
  });
});

describe("a question that is no longer open", () => {
  it("an error turn after a done turn with a question sends no history", () => {
    const asked = finishTurn(startTurn([], "more money").turns, 1, resultWith({ question: "Which band?" }));
    const failed = failTurn(startTurn(asked, "B4").turns, 2, "The model is busy.");
    // pendingQuestion only looks at the last turn, so the earlier question is no longer open.
    expect(requestFor(failed, "B4 again", base)).toEqual({ message: "B4 again", current: base });
  });
});

describe("turn transitions with unknown ids and empty lists", () => {
  const one = startTurn([], "one").turns;

  it("progress, finish and fail with an unknown id change nothing and throw nothing", () => {
    expect(progressTurn(one, 99, { type: "stage", stage: "explaining" })).toEqual(one);
    expect(finishTurn(one, 99, resultWith())).toEqual(one);
    expect(failTurn(one, 99, "bad")).toEqual(one);
  });

  it("all three are no-ops on an empty list", () => {
    expect(progressTurn([], 1, { type: "stage", stage: "explaining" })).toEqual([]);
    expect(finishTurn([], 1, resultWith())).toEqual([]);
    expect(failTurn([], 1, "bad")).toEqual([]);
  });
});

describe("numbering after gaps", () => {
  it("startTurn numbers one past the highest id, not past the list length", () => {
    const gappy: Turn[] = [
      { id: 1, message: "a", status: "done", result: resultWith() },
      { id: 5, message: "b", status: "done", result: resultWith() },
    ];
    const next = startTurn(gappy, "c");
    expect(next.id).toBe(6);
    expect(next.turns.map((t) => t.id)).toEqual([1, 5, 6]);
  });
});

describe("held answers (review fix)", () => {
  const turn = () =>
    finishTurn(startTurn([], "within 2 years").turns, 1, {
      interpretation: {
        status: "applied",
        next: SAMPLE_PERSON.constraints,
        applied: [],
        refused: [],
        unsupported: [],
        conflicts: [],
        notes: [],
      },
    } as unknown as WhatIfResult);
  it("holdTurn marks only a finished turn, releaseTurn clears the mark", () => {
    const held = holdTurn(turn(), 1);
    expect(held[0]?.held).toBe(true);
    expect("held" in (releaseTurn(held, 1)[0] as object)).toBe(false);
    const working = startTurn([], "x").turns;
    expect(holdTurn(working, 1)).toEqual(working);
    expect(holdTurn(turn(), 99)).toEqual(turn());
    expect(releaseTurn(turn(), 99)).toEqual(turn());
  });
  it("requestFor cuts a long reply without splitting an emoji", () => {
    const asked = finishTurn(startTurn([], "x").turns, 1, {
      interpretation: {
        status: "needs_clarification",
        next: SAMPLE_PERSON.constraints,
        applied: [],
        refused: [],
        unsupported: [],
        conflicts: [],
        notes: [],
        clarification: { question: "q".repeat(399) + "😀", about: "other" },
      },
    } as unknown as WhatIfResult);
    const history = requestFor(asked, "a".repeat(599) + "😀", SAMPLE_PERSON.constraints).history?.[0];
    expect(history?.question).toBe("q".repeat(399));
    expect(history?.answer).toBe("a".repeat(599));
  });
});

/**
 * interpret.ts: the What-if interpreter agent.
 *
 *   one sentence from the user  ->  validated constraint changes
 *
 * The pipeline, and who is trusted at each step:
 *   1. INPUT        the user's text is sanitised and length-capped (it is untrusted).
 *   2. MODEL        proposes changes, unsupported requests, contradictions, a question.
 *   3. QUOTE GUARD  anything whose quoted words are not in what the user wrote is discarded.
 *   4. APPLY        code validates every value, detects fields that fight each other, and
 *                   builds the new constraints. The model never writes constraints directly.
 *   5. EVIDENCE     the engine recomputes the fast path with the new constraints; conflicts
 *                   with the evidence ("no route fits in 6 months") are reported with numbers.
 *   6. STATUS       applied, needs_clarification, or nothing_applicable.
 *
 * Clear parts of a message are applied even when another part needs a question, so the map
 * can redraw immediately while the interface asks the follow-up.
 */
import { noEmit, type Emit } from "../agents/events";
import { gatherEvidence } from "../engine";
import { chatStructured, type ModelClient, type ReasoningEffort } from "../model";
import type { Constraints, Goal, Profile } from "../schemas";
import { EvidenceLedger } from "../tools/ledger";
import { applyChanges, phraseInText } from "./apply";
import { evidenceConflicts } from "./conflicts";
import { INTERPRET_SYSTEM_PROMPT, interpretUserMessage, type ClarificationTurn } from "./prompts";
import {
  ModelOutput,
  type ChangeField,
  type Clarification,
  type Conflict,
  type Contradiction,
  type Interpretation,
} from "./schemas";

/** Longest message accepted, in characters. A What-if request is a sentence, not an essay. */
export const MAX_MESSAGE_CHARS = 500;
/** Most earlier clarification turns replayed to the model. */
const MAX_HISTORY_TURNS = 3;

/** Thrown for input the interpreter will not process (empty or too long). */
export class WhatIfInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatIfInputError";
  }
}

export interface InterpretDeps {
  client: ModelClient;
  emit?: Emit;
  /** Reasoning effort. Minimal by default: this is translation, and minimal measured fastest and reliable. */
  effort?: ReasoningEffort;
}

export interface WhatIfInput {
  /** What the person typed. */
  message: string;
  /** The constraints before this message. */
  current: Constraints;
  profile: Profile;
  goal: Goal;
  /** Earlier question-and-answer turns, when the person is answering a clarification. */
  history?: readonly ClarificationTurn[];
}

/** Strip control characters (keeping newlines and tabs) and surrounding whitespace. */
function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/** Validate and sanitise the user's message and history. */
function sanitise(input: WhatIfInput): { message: string; history: ClarificationTurn[] } {
  const message = cleanText(input.message);
  if (message.length === 0) throw new WhatIfInputError("The What-if message is empty.");
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new WhatIfInputError(
      `The What-if message is too long (${message.length} characters; the limit is ${MAX_MESSAGE_CHARS}).`,
    );
  }
  const history = (input.history ?? []).slice(-MAX_HISTORY_TURNS).map((turn) => ({
    question: cleanText(turn.question).slice(0, 250),
    answer: cleanText(turn.answer).slice(0, 300),
  }));
  return { message, history };
}

/** The question code asks when it finds a contradiction the model did not turn into a question. */
function contradictionQuestion(contradiction: Contradiction): Clarification {
  return {
    question: `${contradiction.description} Which do you want?`,
    about: contradiction.fields[0] ?? "other",
    options: contradiction.phrases.slice(0, 4).map((phrase) => phrase.slice(0, 60)),
  };
}

/**
 * Interpret one What-if message.
 *
 * @throws WhatIfInputError for an empty or over-long message
 * @throws ModelParseError if the model's output is invalid even after the repair retry
 */
export async function interpretWhatIf(deps: InterpretDeps, input: WhatIfInput): Promise<Interpretation> {
  const emit = deps.emit ?? noEmit;
  const { message, history } = sanitise(input);
  emit({ type: "stage", stage: "interpreting" });

  // ---- MODEL ----
  const { data: output } = await chatStructured(
    deps.client,
    {
      label: "whatif:interpret",
      target: "spark",
      reasoningEffort: deps.effort ?? "minimal",
      maxCompletionTokens: 3000,
      messages: [
        { role: "system", content: INTERPRET_SYSTEM_PROMPT },
        {
          role: "user",
          content: interpretUserMessage({
            message,
            current: input.current,
            profile: input.profile,
            goal: input.goal,
            history,
          }),
        },
      ],
    },
    ModelOutput,
  );

  const notes: string[] = [];

  // ---- QUOTE GUARD: only words the person actually wrote count (their message and their answers) ----
  const userText = [message, ...history.map((turn) => turn.answer)].join("\n");
  const quoted = <T extends { phrase: string }>(items: readonly T[]): T[] =>
    items.filter((item) => phraseInText(item.phrase, userText));
  const changes = quoted(output.changes);
  const unsupported = quoted(output.unsupported);
  const modelContradictions = output.contradictions.filter((c) =>
    c.phrases.every((phrase) => phraseInText(phrase, userText)),
  );
  const discarded =
    output.changes.length -
    changes.length +
    (output.unsupported.length - unsupported.length) +
    (output.contradictions.length - modelContradictions.length);
  if (discarded > 0)
    notes.push(`Discarded ${discarded} proposed item(s) quoting words the person did not write.`);

  // A contradiction means neither side is applied, so drop changes to the fields it names.
  const contradictedFields = new Set<ChangeField>(modelContradictions.flatMap((c) => c.fields));
  const usable = changes.filter((change) => !contradictedFields.has(change.field));

  // ---- APPLY (code validates; code also detects contradictions the model did not flag) ----
  const result = applyChanges(input.current, usable);
  notes.push(...result.notes);
  const contradictions = [...modelContradictions, ...result.contradictions];

  // ---- EVIDENCE: do the new constraints leave the person any route? ----
  const sheet = gatherEvidence(new EvidenceLedger(), {
    profile: input.profile,
    goal: input.goal,
    constraints: result.next,
  });
  const conflicts: Conflict[] = [
    ...contradictions.map((c): Conflict => ({
      kind: "contradiction",
      fields: c.fields,
      message: `${c.description} Neither was applied.`,
    })),
    ...evidenceConflicts(sheet, result.next),
  ];

  // ---- STATUS ----
  const firstContradiction = contradictions[0];
  const clarification: Clarification | undefined =
    output.clarification ?? (firstContradiction ? contradictionQuestion(firstContradiction) : undefined);
  const status = clarification
    ? "needs_clarification"
    : result.applied.length > 0
      ? "applied"
      : "nothing_applicable";

  return {
    status,
    next: result.next,
    applied: result.applied,
    refused: result.refused,
    unsupported,
    conflicts,
    ...(clarification ? { clarification } : {}),
    notes,
  };
}

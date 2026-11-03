/**
 * assess.ts: the Privacy Guard.
 *
 *   profile + goal + optional story text
 *     -> LADDER      how the crowd of comparable engineers shrinks as each attribute is shared (code)
 *     -> DETECTORS   contact details, exact dates, exact pay (code)
 *     -> MODEL       Muse Spark proposes other identifying details, each quoting the text
 *     -> GUARD       a finding is kept only if its quote is in the text and is not a generic word
 *     -> VERDICT     risk level and reasons decided by code
 *     -> PREVIEW     the text with every finding replaced by a fixed placeholder
 *
 * If the model is unavailable the Guard still returns the ladder, the detectors and a preview,
 * and says the text check was code-only: a degraded answer, never a missing or a made-up one.
 *
 * What it is not: a guarantee. The cohort is synthetic, so the ladder demonstrates the method on
 * this dataset; it cannot say how unique someone is in the real world.
 */
import { noEmit, type Emit } from "../agents/events";
import { redactPii } from "../intake/redact";
import { chatStructured, type ModelClient, type ReasoningEffort } from "../model";
import type { Goal, Profile } from "../schemas";
import { COHORT } from "../tools/data";
import { phraseInText } from "../whatif/apply";
import { detectIdentifiers } from "./detectors";
import { DEFAULT_K, disclosureLadder } from "./ladder";
import { generalise } from "./preview";
import { PRIVACY_SYSTEM_PROMPT, privacyUserMessage } from "./prompts";
import { PrivacyModelOutput, type PrivacyAssessment, type PrivacyFinding } from "./schemas";

/** Longest story accepted, in characters. */
export const MAX_STORY_CHARS = 3000;
/** A crowd smaller than this is treated as identifying on its own. */
export const VERY_SMALL_CROWD = 3;

/** Thrown for input the Guard will not process. */
export class PrivacyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyInputError";
  }
}

export interface PrivacyDeps {
  client: ModelClient;
  emit?: Emit;
  effort?: ReasoningEffort;
}

export interface PrivacyInput {
  profile: Profile;
  goal: Goal;
  /** The career story the person would share. Optional: without it only the ladder is computed. */
  text?: string;
  companyType?: string;
  /** Size of crowd to stay hidden in. Default 10. */
  k?: number;
  /** Ask Muse Spark to read the text. Default true; false keeps the check to code only (nothing is sent). */
  useModel?: boolean;
}

/** Strip control characters (keeping newlines and tabs). */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/** Words already disclosed by the profile, which are not worth flagging again. */
function profileWords(profile: Profile): Set<string> {
  return new Set(
    [profile.roleFamily, profile.level, profile.region, ...profile.stack].map((w) => w.trim().toLowerCase()),
  );
}

/**
 * Assess how identifying a profile and an optional story are.
 *
 * @throws PrivacyInputError when the story is too long or k is not a whole number of at least 1
 */
export async function assessPrivacy(deps: PrivacyDeps, input: PrivacyInput): Promise<PrivacyAssessment> {
  const emit = deps.emit ?? noEmit;
  const k = input.k ?? DEFAULT_K;
  if (!Number.isInteger(k) || k < 1)
    throw new PrivacyInputError(`k must be a whole number of at least 1 (got ${k}).`);
  const text = input.text === undefined ? "" : clean(input.text);
  if (text.length > MAX_STORY_CHARS) {
    throw new PrivacyInputError(
      `The text is too long (${text.length} characters; the limit is ${MAX_STORY_CHARS}).`,
    );
  }
  emit({ type: "stage", stage: "protecting" });

  // ---- LADDER (code) ----
  const ladder = disclosureLadder({
    profile: input.profile,
    goal: input.goal,
    k,
    ...(input.companyType ? { companyType: input.companyType } : {}),
  });
  const notes = [...ladder.notes];

  // ---- DETECTORS (code) ----
  const findings: PrivacyFinding[] = text.length > 0 ? detectIdentifiers(text) : [];
  let textCheck: PrivacyAssessment["textCheck"] = text.length === 0 ? "skipped" : "code_only";

  // ---- MODEL (Muse Spark), then the GUARD ----
  if (text.length > 0 && input.useModel !== false) {
    try {
      // The model sees the text with contact details already removed: code handles those.
      const { data } = await chatStructured(
        deps.client,
        {
          label: "privacy:review",
          target: "spark",
          reasoningEffort: deps.effort ?? "minimal",
          maxCompletionTokens: 3000,
          messages: [
            { role: "system", content: PRIVACY_SYSTEM_PROMPT },
            { role: "user", content: privacyUserMessage(redactPii(text).text) },
          ],
        },
        PrivacyModelOutput,
      );
      textCheck = "done";
      const generic = profileWords(input.profile);
      const known = new Set(findings.map((f) => f.quote.toLowerCase()));
      let discarded = 0;
      for (const proposed of data.findings) {
        const quote = proposed.quote.trim();
        if (!phraseInText(quote, text)) {
          discarded++;
        } else if (generic.has(quote.toLowerCase())) {
          notes.push(`Ignored "${quote.slice(0, 30)}": your profile already shares it.`);
        } else if (!known.has(quote.toLowerCase())) {
          known.add(quote.toLowerCase());
          findings.push({ quote, category: proposed.category, reason: proposed.reason, source: "model" });
        }
      }
      if (discarded > 0)
        notes.push(`Discarded ${discarded} proposed item(s) quoting words that are not in your text.`);
    } catch (error) {
      notes.push(
        `The model check was unavailable (${error instanceof Error ? error.name : "error"}), so only code checks ran on your text.`,
      );
    }
  }

  // ---- VERDICT (code) ----
  const fullSize = ladder.rungs.at(-1)?.size ?? 0;
  const contact = findings.some((f) => f.category === "contact_detail");
  const personName = findings.some((f) => f.category === "person_name");
  const reasons: string[] = [];
  if (contact) reasons.push("Your text contains contact details that point straight at you.");
  if (personName) reasons.push("Your text names a person.");
  if (fullSize < VERY_SMALL_CROWD)
    reasons.push(`Only ${fullSize} comparable engineer(s) in the data share everything you would share.`);
  else if (!ladder.fullPasses)
    reasons.push(
      `Only ${fullSize} comparable engineers share everything you would share; a crowd of ${k} or more is safer.`,
    );
  if (findings.length > 0)
    reasons.push(`${findings.length} detail(s) in your text could identify you or someone else.`);
  const risk: PrivacyAssessment["risk"] =
    contact || personName || fullSize < VERY_SMALL_CROWD
      ? "high"
      : !ladder.fullPasses || findings.length > 0
        ? "medium"
        : "low";
  if (risk === "low")
    reasons.push(`The crowd stays at ${fullSize} or more and nothing in the text stood out.`);

  return {
    risk,
    reasons,
    k,
    ladder: ladder.rungs,
    fullPasses: ladder.fullPasses,
    shareableUpTo: ladder.shareableUpTo,
    dropToReachK: ladder.dropToReachK,
    findings,
    textCheck,
    generalisedText: text.length === 0 ? null : generalise(text, findings),
    notes,
    basis: `Counts come from a synthetic cohort of ${COHORT.length} generated career histories. They show how the method works on this dataset; they are not a statement about how unique anyone is in the real world.`,
  };
}

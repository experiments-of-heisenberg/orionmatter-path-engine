/** Helpers for What-if UI tests: a real conversation, run through the real handlers with a scripted model. */
import { handleWhatIf, type WhatIfResult } from "../../src/lib/api/handlers";
import { WhatIfRequest } from "../../src/lib/api/schemas";
import type { Services } from "../../src/lib/api/services";
import { createMockClient, reply } from "../../src/lib/model";
import type { Constraints } from "../../src/lib/schemas";
import { SAMPLE_PERSON } from "../../src/ui/sample";

/** What the interpreter model "says" for one message, as the model client would return it. */
export function says(output: object) {
  return reply(
    JSON.stringify({ unsupported: [], contradictions: [], clarification: null, changes: [], ...output }),
  );
}

/** Run one What-if turn for the sample person through the real handler (no narration model call). */
export function asked(
  message: string,
  output: object,
  current: Constraints = SAMPLE_PERSON.constraints,
): Promise<WhatIfResult> {
  const request = WhatIfRequest.parse({
    message,
    current,
    profile: SAMPLE_PERSON.profile,
    goal: SAMPLE_PERSON.goal,
    narrate: false,
  });
  return handleWhatIf(
    { client: createMockClient([says(output)]) } as unknown as Services,
    request,
    () => undefined,
  );
}

/** The two answers the previews show: limits applied with a refusal-free reading, and a question with options. */
export async function sampleConversation(): Promise<{ first: WhatIfResult; second: WhatIfResult }> {
  const first = await asked("What if I won't relocate and want to get there within 2 years?", {
    changes: [
      { field: "noRelocation", value: true, phrase: "I won't relocate" },
      { field: "maxMonths", value: 24, phrase: "within 2 years" },
    ],
  });
  const second = await asked(
    "I want more money, and a 4-day week",
    {
      unsupported: [{ phrase: "a 4-day week", reason: "Work-week length is not in the cohort data." }],
      clarification: {
        question: "Which minimum pay band do you want? B1 is lowest, B5 highest.",
        about: "minCompBand",
        options: ["B3", "B4", "B5"],
      },
    },
    first.interpretation.next,
  );
  return { first, second };
}

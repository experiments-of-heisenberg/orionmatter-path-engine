/**
 * drafts.ts: the part of a plan the MODEL writes.
 *
 * A draft contains words and structure only: a summary and the steps with their evidence
 * citations. It deliberately has no `metrics`, `radar` or `evidenceThin` fields. Those
 * come from code (see assemble.ts). If a model adds such fields anyway, Zod strips them,
 * so a model cannot alter a number even by accident.
 */
import { z } from "zod";
import { Archetype, Step } from "../schemas";

/** One route as drafted by the model. */
export const RouteDraft = z.object({
  archetype: Archetype,
  summary: z.string().max(400),
  steps: z.array(Step).min(2).max(6),
});
export type RouteDraft = z.infer<typeof RouteDraft>;

/** A full plan draft: exactly one route per archetype, plus optional extra caveats. */
export const PlanDraft = z
  .object({
    routes: z.array(RouteDraft).length(3),
    // Optional: code always adds the survivorship caveat, so a missing list is harmless.
    caveats: z.array(z.string().max(300)).max(4).default([]),
  })
  .superRefine((draft, ctx) => {
    // Failing this check feeds the repair retry a clear message about what is missing.
    const found = new Set(draft.routes.map((route) => route.archetype));
    for (const wanted of Archetype.options) {
      if (!found.has(wanted)) {
        ctx.addIssue({
          code: "custom",
          path: ["routes"],
          message: `missing a route for archetype "${wanted}"`,
        });
      }
    }
  });
export type PlanDraft = z.infer<typeof PlanDraft>;

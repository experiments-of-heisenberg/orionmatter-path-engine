/** GET /api/health: is the server up, and in which mode? Never reveals a key, only whether one is set. */
import { COHORT } from "../../../lib/tools/data";
import { getServices } from "../../../lib/api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const { env } = getServices();
  return Response.json(
    {
      ok: true,
      mode: env.USE_FIXTURES ? "fixtures" : "live",
      model: env.META_MODEL_SPARK,
      keyConfigured: Boolean(env.MODEL_API_KEY),
      cohort: { records: COHORT.length, synthetic: true },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

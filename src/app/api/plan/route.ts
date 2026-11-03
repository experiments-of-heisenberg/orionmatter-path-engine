/** POST /api/plan: the full Planner and Skeptic run. Streams every agent step, then the verified plan. */
import { MAX_JSON_BYTES } from "../../../lib/api/body";
import { handlePlan } from "../../../lib/api/handlers";
import { defineRoute } from "../../../lib/api/route";
import { PlanRequest } from "../../../lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = defineRoute({
  name: "plan",
  schema: PlanRequest,
  maxBytes: MAX_JSON_BYTES,
  limiter: "plan",
  usesModel: true,
  mode: "sse",
  run: ({ services, body, emit }) => handlePlan(services, body, emit),
});

/** POST /api/intake: read a person's words or a screenshot into a draft profile. Streams progress, then the result. */
import { MAX_INTAKE_BODY_BYTES } from "../../../lib/api/body";
import { handleIntake } from "../../../lib/api/handlers";
import { defineRoute } from "../../../lib/api/route";
import { IntakeRequest } from "../../../lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineRoute({
  name: "intake",
  schema: IntakeRequest,
  maxBytes: MAX_INTAKE_BODY_BYTES,
  limiter: "model",
  usesModel: true,
  mode: "sse",
  run: ({ services, body, emit }) => handleIntake(services, body, emit),
});

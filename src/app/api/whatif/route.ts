/** POST /api/whatif: interpret a sentence, recompute the plan, diff it, explain it. Streams progress, then the result. */
import { MAX_JSON_BYTES } from "../../../lib/api/body";
import { handleWhatIf } from "../../../lib/api/handlers";
import { defineRoute } from "../../../lib/api/route";
import { WhatIfRequest } from "../../../lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineRoute({
  name: "whatif",
  schema: WhatIfRequest,
  maxBytes: MAX_JSON_BYTES,
  limiter: "model",
  usesModel: true,
  mode: "sse",
  run: ({ services, body, emit }) => handleWhatIf(services, body, emit),
});

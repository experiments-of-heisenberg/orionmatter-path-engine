/** POST /api/privacy: how identifying is this profile and story? Disclosure ladder, detectors, a guarded model check. */
import { MAX_JSON_BYTES } from "../../../lib/api/body";
import { handlePrivacy } from "../../../lib/api/handlers";
import { defineRoute } from "../../../lib/api/route";
import { PrivacyRequest } from "../../../lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = defineRoute({
  name: "privacy",
  schema: PrivacyRequest,
  maxBytes: MAX_JSON_BYTES,
  limiter: "model",
  usesModel: true,
  mode: "json",
  run: ({ services, body, emit }) => handlePrivacy(services, body, emit),
});

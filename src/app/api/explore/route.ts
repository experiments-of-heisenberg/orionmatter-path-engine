/** POST /api/explore: the instant, model-free path for sliders: fact sheet, tornado, smallest helpful changes, conflicts. */
import { MAX_JSON_BYTES } from "../../../lib/api/body";
import { handleExplore } from "../../../lib/api/handlers";
import { defineRoute } from "../../../lib/api/route";
import { ExploreRequest } from "../../../lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "explore",
  schema: ExploreRequest,
  maxBytes: MAX_JSON_BYTES,
  limiter: "light",
  usesModel: false,
  mode: "json",
  run: ({ body }) => Promise.resolve(handleExplore(body)),
});

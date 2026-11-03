/**
 * env.ts: validated runtime configuration.
 *
 * Why: misconfiguration should fail loudly at startup with a clear message, not as a
 * confusing 401 deep inside an agent run. All environment access goes through here,
 * so the rest of the code receives a typed, validated object and never touches
 * `process.env` directly.
 *
 * Secrets: error messages list variable NAMES and problems, never values.
 */
import { z } from "zod";

/** "true" / "false" strings from the environment, parsed to a real boolean. */
const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const EnvSchema = z
  .object({
    // Meta Model API (Muse Spark): Planner, Skeptic, What-if, Intake, Privacy Guard. The only model provider.
    MODEL_API_KEY: z.string().min(1).optional(),
    META_API_BASE_URL: z.url().default("https://api.meta.ai/v1"),
    META_MODEL_SPARK: z.string().min(1).default("muse-spark-1.3"),

    // API protection (per server instance). Model routes are the costly ones.
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(12),
    MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(100).default(6),

    // When true, agents replay recorded fixtures instead of calling the live APIs.
    // Used as the demo fallback and for offline development.
    USE_FIXTURES: booleanFlag,

    // When true, live model responses are saved as fixtures (needs real keys).
    RECORD_FIXTURES: booleanFlag,

    // Minimum log level: debug, info, warn or error.
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // Seed for the synthetic cohort generator, so data is reproducible.
    COHORT_SEED: z.coerce.number().int().default(1026),
  })
  .superRefine((env, ctx) => {
    // Replaying and recording are opposites: replay never calls the API, record always does.
    if (env.USE_FIXTURES && env.RECORD_FIXTURES) {
      ctx.addIssue({
        code: "custom",
        path: ["RECORD_FIXTURES"],
        message: "RECORD_FIXTURES cannot be true while USE_FIXTURES is true",
      });
    }
    // Live mode needs the key. Fixture replay needs none.
    if (!env.USE_FIXTURES && !env.MODEL_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["MODEL_API_KEY"],
        message: "MODEL_API_KEY is required unless USE_FIXTURES=true",
      });
    }
  });

/** Validated, typed configuration. */
export type Env = z.infer<typeof EnvSchema>;

/** Thrown when the environment is invalid. The message never contains secret values. */
export class EnvError extends Error {
  constructor(details: string) {
    super(`Invalid environment configuration:\n${details}`);
    this.name = "EnvError";
  }
}

/**
 * Validate an environment-like object. Pure and side-effect free, so it is trivial to test.
 *
 * @param source a map of variable names to values (usually `process.env`)
 * @throws EnvError listing every problem found
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) throw new EnvError(z.prettifyError(result.error));
  return result.data;
}

let cached: Env | undefined;

/** Validated process environment, parsed once and memoised. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Clear the memoised environment. Intended for tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

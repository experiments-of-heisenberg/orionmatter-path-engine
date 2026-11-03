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
    // Meta Model API (Muse Spark): Planner, Skeptic, What-if, Intake.
    MODEL_API_KEY: z.string().min(1).optional(),
    META_API_BASE_URL: z.url().default("https://api.meta.ai/v1"),
    META_MODEL_SPARK: z.string().min(1).default("muse-spark-1.3"),

    // Baseten (Muse Spark Open, open weights): Privacy Guard.
    BASETEN_API_KEY: z.string().min(1).optional(),
    OPEN_API_BASE_URL: z.url().default("https://inference.baseten.co/v1"),
    OPEN_MODEL_ID: z.string().min(1).default("meta-models/muse-spark-open-1026"),

    // When true, agents replay recorded fixtures instead of calling the live APIs.
    // Used as the demo fallback and for offline development.
    USE_FIXTURES: booleanFlag,

    // Seed for the synthetic cohort generator, so data is reproducible.
    COHORT_SEED: z.coerce.number().int().default(1026),
  })
  .superRefine((env, ctx) => {
    // Live mode needs both keys. Fixture mode needs neither.
    if (env.USE_FIXTURES) return;
    for (const key of ["MODEL_API_KEY", "BASETEN_API_KEY"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required unless USE_FIXTURES=true`,
        });
      }
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

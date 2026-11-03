/**
 * log.ts: structured logging with secret redaction.
 *
 * Why: the model client runs against paid APIs with real keys, and agent code handles
 * user career data. Logs must be useful (latency, tokens, retries) without ever leaking
 * a key or the content of a conversation. Every message and field passes through
 * redaction before it reaches the sink.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured fields attached to a log line. Values are redacted before output. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Patterns that look like credentials even when we do not know the exact value. */
const SECRET_PATTERNS: RegExp[] = [
  /LLM_\d{6,}_[A-Za-z0-9]{8,}/g, // Meta Model API keys
  /Bearer\s+[A-Za-z0-9._-]{16,}/g, // Authorization headers
];

/** Shortest secret we will redact by exact match; shorter strings would cause false positives. */
const MIN_SECRET_LENGTH = 8;

/**
 * Replace known secret values and credential-shaped strings with a placeholder.
 *
 * @param text    string to clean
 * @param secrets exact secret values to remove (e.g. the configured API keys)
 */
export function redactString(text: string, secrets: readonly string[] = []): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) clean = clean.split(secret).join("[REDACTED]");
  }
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, "[REDACTED]");
  return clean;
}

/** Recursively redact every string inside a value (objects, arrays, strings). */
export function redactValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value instanceof Error) return redactString(`${value.name}: ${value.message}`, secrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]));
  }
  return value;
}

export interface LoggerOptions {
  /** Minimum level to emit. Default "info". */
  level?: LogLevel;
  /** Exact secret values to redact (API keys). */
  secrets?: readonly string[];
  /** Where finished lines go. Default: one JSON object per line on stderr. */
  sink?: (line: string) => void;
  /** Clock, injectable for deterministic tests. */
  now?: () => Date;
}

/** Create a logger that filters by level and redacts secrets from every line. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const { level = "info", secrets = [], sink = (line) => process.stderr.write(`${line}\n`) } = options;
  const now = options.now ?? (() => new Date());

  const emit = (lineLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[lineLevel] < LEVEL_ORDER[level]) return;
    const record = {
      time: now().toISOString(),
      level: lineLevel,
      message: redactString(message, secrets),
      ...(redactValue(fields ?? {}, secrets) as LogFields),
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}

/** A logger that discards everything. The default for tests and library code. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Tests for logging: level filtering and, most importantly, secret redaction. */
import { describe, expect, it } from "vitest";
import { createLogger, redactString, redactValue } from "../src/lib/log";

const secret = "super-secret-token-value"; // scan-secrets:allow fake test value

describe("redaction", () => {
  it("removes exact secret values", () => {
    expect(redactString(`calling with ${secret} now`, [secret])).toBe("calling with [REDACTED] now");
  });

  it("removes credential-shaped strings even when the exact value is unknown", () => {
    // Assembled from parts so this file never contains a literal key-shaped string.
    const fakeMetaKey = ["LLM", "1234567890", "abcdefghijkl"].join("_");
    expect(redactString(`key ${fakeMetaKey} leaked`)).toBe("key [REDACTED] leaked");
    expect(redactString("Authorization: Bearer abcdefghijklmnopqrstuv")).toBe("Authorization: [REDACTED]");
  });

  it("does not redact very short secrets, which would mangle ordinary text", () => {
    expect(redactString("a cat sat", ["cat"])).toBe("a cat sat");
  });

  it("redacts inside nested objects, arrays and errors", () => {
    const cleaned = redactValue({ a: [`x ${secret}`], b: { c: new Error(`bad ${secret}`) }, n: 5 }, [secret]);
    expect(JSON.stringify(cleaned)).not.toContain(secret);
    expect((cleaned as { n: number }).n).toBe(5);
  });
});

describe("createLogger", () => {
  it("filters below the configured level", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "warn", sink: (line) => lines.push(line) });
    log.info("hidden");
    log.warn("shown");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ level: "warn", message: "shown" });
  });

  it("redacts secrets from messages and fields before they reach the sink", () => {
    const lines: string[] = [];
    const log = createLogger({ secrets: [secret], sink: (line) => lines.push(line), now: () => new Date(0) });
    log.error(`failed with ${secret}`, { detail: `header ${secret}` });
    expect(lines.join("")).not.toContain(secret);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ time: "1970-01-01T00:00:00.000Z", level: "error" });
  });
});

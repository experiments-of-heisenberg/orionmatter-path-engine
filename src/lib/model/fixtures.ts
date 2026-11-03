/**
 * fixtures.ts: record and replay of model responses.
 *
 * Why: the demo must not depend on a live API being fast, available and within rate
 * limits at the moment of recording. In record mode every live response is saved; in
 * replay mode the client answers from those files and never touches the network. The same
 * mechanism makes agent runs reproducible offline.
 *
 * Fixtures are keyed by a hash of the request CONTENT (target, model, messages, tools and
 * generation settings). Same request, same fixture. Headers, keys and the human label are
 * not part of the key, and keys are never written to disk.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { stableStringify } from "../stable";
import type { ChatRequest, ChatResult } from "./types";

// Re-exported so existing imports from the model layer keep working.
export { stableStringify };

/** off = always live, record = live and save, replay = never live. */
export type FixtureMode = "off" | "record" | "replay";

/** What we store: the result minus per-call facts (latency, attempts) that mean nothing on replay. */
export type FixtureResult = Omit<ChatResult, "attempts" | "latencyMs" | "fromFixture">;

export interface FixtureStore {
  get(key: string): Promise<FixtureResult | undefined>;
  put(key: string, label: string, result: FixtureResult): Promise<void>;
}

/**
 * Content hash identifying a request.
 *
 * Only inputs that change the model's answer are included. The label, timeout and abort
 * signal are excluded on purpose.
 */
export function fixtureKey(request: ChatRequest, model: string): string {
  const content = {
    target: request.target,
    model,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    reasoningEffort: request.reasoningEffort,
    maxCompletionTokens: request.maxCompletionTokens,
    temperature: request.temperature,
  };
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

/** Validates a fixture file on read, so a hand-edited or corrupt file fails clearly. */
const FixtureFile = z.object({
  key: z.string(),
  label: z.string(),
  result: z.object({
    text: z.string(),
    toolCalls: z.array(z.object({ id: z.string(), name: z.string(), arguments: z.string() })),
    finishReason: z.string(),
    usage: z.object({ promptTokens: z.number(), completionTokens: z.number(), reasoningTokens: z.number() }),
    model: z.string(),
    reasoning: z.string().optional(),
  }),
});

/** In-memory store, used by tests. */
export class MemoryFixtureStore implements FixtureStore {
  readonly entries = new Map<string, { label: string; result: FixtureResult }>();

  get(key: string): Promise<FixtureResult | undefined> {
    return Promise.resolve(this.entries.get(key)?.result);
  }

  put(key: string, label: string, result: FixtureResult): Promise<void> {
    this.entries.set(key, { label, result });
    return Promise.resolve();
  }
}

/** One JSON file per fixture, named by the first 16 hex chars of the key. */
export class FileFixtureStore implements FixtureStore {
  constructor(private readonly directory: string) {}

  private pathFor(key: string): string {
    return join(this.directory, `${key.slice(0, 16)}.json`);
  }

  async get(key: string): Promise<FixtureResult | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(key), "utf8");
    } catch {
      return undefined; // no file: a miss, not an error
    }
    const parsed = FixtureFile.parse(JSON.parse(raw));
    // 16 hex chars is plenty to avoid collisions, but check the full key anyway.
    return parsed.key === key ? parsed.result : undefined;
  }

  async put(key: string, label: string, result: FixtureResult): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = { key, label, result };
    await writeFile(this.pathFor(key), `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

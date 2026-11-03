/** Tests for fixture keys, the file store and the in-memory store. No network involved. */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileFixtureStore,
  MemoryFixtureStore,
  stableStringify,
  type FixtureResult,
} from "../src/lib/model/fixtures";

describe("stableStringify", () => {
  it("sorts object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("ignores undefined values", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("is stable for nested data whatever the original key order", () => {
    const one = stableStringify({ z: { b: 1, a: [3, { d: 4, c: 3 }] }, a: 0 });
    const two = stableStringify({ a: 0, z: { a: [3, { c: 3, d: 4 }], b: 1 } });
    expect(one).toBe('{"a":0,"z":{"a":[3,{"c":3,"d":4}],"b":1}}');
    expect(two).toBe(one);
  });
});

const sample: FixtureResult = {
  text: "hello",
  toolCalls: [{ id: "c1", name: "findTwins", arguments: '{"a":1}' }],
  finishReason: "stop",
  usage: { promptTokens: 10, completionTokens: 5, reasoningTokens: 1 },
  model: "test-model",
};

// Two different keys sharing their first 16 characters.
const KEY_A = "0123456789abcdef" + "a".repeat(48);
const KEY_B = "0123456789abcdef" + "b".repeat(48);
const MISSING_KEY = "f".repeat(64);

describe("FileFixtureStore", () => {
  let directory!: string;
  let store!: FileFixtureStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "orion-fixtures-test-"));
    store = new FileFixtureStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips a recorded result", async () => {
    await store.put(KEY_A, "test-label", sample);
    await expect(store.get(KEY_A)).resolves.toEqual(sample);
  });

  it("returns undefined when no file exists for the key", async () => {
    await expect(store.get(MISSING_KEY)).resolves.toBeUndefined();
  });

  it("names the file after the first 16 characters of the key", async () => {
    await store.put(KEY_A, "test-label", sample);
    await expect(readdir(directory)).resolves.toEqual(["0123456789abcdef.json"]);
  });

  it("rejects on a corrupt file instead of swallowing it", async () => {
    await writeFile(join(directory, `${MISSING_KEY.slice(0, 16)}.json`), "not json{{{", "utf8");
    await expect(store.get(MISSING_KEY)).rejects.toThrow();
  });

  it("rejects on a well-formed file with the wrong shape", async () => {
    await writeFile(
      join(directory, `${MISSING_KEY.slice(0, 16)}.json`),
      JSON.stringify({ nope: true }),
      "utf8",
    );
    await expect(store.get(MISSING_KEY)).rejects.toThrow();
  });

  it("returns undefined when the stored key differs despite the shared prefix", async () => {
    await store.put(KEY_A, "test-label", sample);
    await expect(store.get(KEY_B)).resolves.toBeUndefined();
  });
});

describe("MemoryFixtureStore", () => {
  it("round-trips a recorded result and misses unknown keys", async () => {
    const store = new MemoryFixtureStore();
    await expect(store.get(KEY_A)).resolves.toBeUndefined();
    await store.put(KEY_A, "test-label", sample);
    await expect(store.get(KEY_A)).resolves.toEqual(sample);
  });
});

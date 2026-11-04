/**
 * docsEdges.test.ts: the commands, variables and placeholders in the final documents exist.
 *
 * Why: a judge follows the README and the deploy/demo/submission guides
 * verbatim. Every npm/npx command in a bash block must name a real script
 * or file, every environment variable named must exist, and the link
 * placeholders must be named consistently between the README and the
 * submission draft.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");
const DOCS = ["README.md", "docs/deploy.md", "docs/demo.md", "docs/submission.md"];
const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

/** Every fenced bash block body in a markdown file. */
function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
}

describe("commands in bash blocks name things that exist", () => {
  it.each(DOCS.map((f) => [f]))("%s: npm/npx commands resolve", (file) => {
    const unknown: string[] = [];
    for (const block of bashBlocks(read(file))) {
      for (const line of block.split("\n")) {
        for (const match of line.matchAll(/npm run ([A-Za-z0-9:_.-]+)|npm (test|start|ci)|npx tsx (\S+)/g)) {
          const runName = match[1];
          const npmBuiltin = match[2];
          const tsxFile = match[3];
          if (runName && !(runName in scripts)) unknown.push(`npm run ${runName}`);
          if (tsxFile && !existsSync(tsxFile)) unknown.push(`npx tsx ${tsxFile}`);
          if (npmBuiltin && !["test", "start", "ci"].includes(npmBuiltin)) unknown.push(`npm ${npmBuiltin}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});

/** Variable names from `KEY=value` lines (commented or not) and from env.ts fields. */
function knownEnvVars(): Set<string> {
  const names = new Set<string>();
  for (const line of read(".env.example").split("\n")) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  for (const line of read("src/lib/env.ts").split("\n")) {
    const match = /^\s{4}([A-Z][A-Z0-9_]*):/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

describe("environment variables named in the docs exist", () => {
  it.each(["README.md", "docs/deploy.md"].map((f) => [f]))("%s: names resolve", (file) => {
    const known = knownEnvVars();
    expect(known.size).toBeGreaterThan(5);
    const unknown: string[] = [];
    // All-caps tokens with an underscore look like variable names; <...> are
    // link placeholders and a trailing underscore is a prefix, not a name.
    const text = read(file).replace(/<[A-Z][A-Z0-9_]*>/g, "");
    for (const match of text.matchAll(/\b([A-Z][A-Z0-9_]*_[A-Z0-9_]*)\b/g)) {
      const name = match[1] ?? "";
      if (name.endsWith("_")) continue;
      if (!known.has(name)) unknown.push(name);
    }
    expect([...new Set(unknown)]).toEqual([]);
  });
});

describe("link placeholders are consistent", () => {
  /** Uppercase <PLACEHOLDER_URL> names in a file. */
  const placeholders = (file: string): Set<string> =>
    new Set([...read(file).matchAll(/<([A-Z][A-Z0-9_]*_URL)>/g)].map((m) => m[1] ?? ""));
  it("every placeholder in the README appears in the submission draft", () => {
    const readme = placeholders("README.md");
    const submission = placeholders("docs/submission.md");
    expect(readme.size).toBeGreaterThan(0);
    expect([...readme].filter((name) => !submission.has(name))).toEqual([]);
  });
  it("the only submission-only placeholder is the repo link", () => {
    const readme = placeholders("README.md");
    const submission = placeholders("docs/submission.md");
    // The repository URL is a submission-form field; the README (inside the
    // repo) needs only the live, demo and video links.
    expect([...submission].filter((name) => !readme.has(name))).toEqual(["REPO_URL"]);
  });
});

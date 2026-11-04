/**
 * smoke-e2e.ts: check a running server end to end.
 *
 *   npm run smoke -- http://localhost:3000            code-only checks (no model, no cost)
 *   npm run smoke -- https://your-app.vercel.app --model     also one What if example
 *   npm run smoke -- https://your-app.vercel.app --plan      also a full plan (about half a minute live)
 *
 * Exit code 0 only if every check passed, so it can gate a deploy.
 */
import { runSmoke } from "./lib/smoke";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const plan = args.includes("--plan");
const model = plan || args.includes("--model");

console.log(
  `Smoke test of ${url}${plan ? " (with a full plan)" : model ? " (with a What if example)" : ""}\n`,
);
const results = await runSmoke(url, {
  model,
  plan,
  onResult: (r) => console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}\n         ${r.detail} (${r.ms} ms)`),
});
const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks failed.`,
);
process.exit(failed === 0 ? 0 : 1);

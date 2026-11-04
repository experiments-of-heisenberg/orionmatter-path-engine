/** The whole screen must be buildable for the browser: no Node-only module, and none of the server's data, in what the person downloads. */
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("the app bundles for the browser", () => {
  it("PathApp reaches no Node module, carries no cohort data, and stays a reasonable size", async () => {
    const result = await build({
      entryPoints: ["src/components/PathApp.tsx"],
      bundle: true,
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
      write: false,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    expect(result.errors).toEqual([]);
    const code = result.outputFiles[0]?.text ?? "";
    expect(code).not.toMatch(/node:(crypto|fs|path|url)/);
    expect(code).not.toContain("syn_0"); // no cohort record ids: the data stays on the server
    expect(code).not.toMatch(/MODEL_API_KEY|api\.meta\.ai/);
    // The request-checking library belongs on the server. Pulling it in once made the app five times larger.
    expect(code).not.toMatch(/\$ZodType|ZodError|ZodObject/);
    expect(code.length).toBeLessThan(400_000);
  });

  it("the card and the export helpers need nothing from the server either", async () => {
    for (const entry of [
      "src/components/SharePanel.tsx",
      "src/components/IntakePanel.tsx",
      "src/components/PlanPanel.tsx",
    ]) {
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        platform: "browser",
        format: "esm",
        jsx: "automatic",
        external: ["react", "react/jsx-runtime", "react-dom"],
        write: false,
        logLevel: "silent",
      });
      expect(result.errors).toEqual([]);
      expect(result.outputFiles[0]?.text ?? "").not.toMatch(/node:(crypto|fs|path|url)/);
    }
  });
});

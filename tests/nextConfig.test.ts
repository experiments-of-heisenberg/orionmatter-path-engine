/** The deployed build must carry the recorded answers, and keep the security headers. */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("next.config", () => {
  it("ships the fixtures folder with every API route, and that folder exists", () => {
    const includes = config.outputFileTracingIncludes ?? {};
    expect(includes["/api/**/*"]).toEqual(["./src/fixtures/**/*"]);
    expect(existsSync("src/fixtures")).toBe(true);
  });
  it("keeps the security headers on every path and hides the framework header", async () => {
    const rules = await (config.headers?.() ?? Promise.resolve([]));
    const all = rules.find((r) => r.source === "/:path*");
    const names = (all?.headers ?? []).map((h) => h.key);
    expect(names).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
    expect(config.poweredByHeader).toBe(false);
  });
});

/**
 * Tests for the Next.js configuration: the security headers every response
 * carries, and the build settings (strict mode on, powered-by off, no silent
 * type errors).
 */
import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("next.config", () => {
  it("serves every path with the security headers", async () => {
    const rules = (await config.headers?.()) ?? [];
    const every = rules.find((rule) => rule.source === "/:path*");
    expect(every).toBeDefined();
    const headers = Object.fromEntries((every?.headers ?? []).map((header) => [header.key, header.value]));
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    const permissions = headers["Permissions-Policy"] ?? "";
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("microphone=()");
    expect(permissions).toContain("geolocation=()");
  });

  it("hides the powered-by header, keeps strict mode on, and never ignores type errors", () => {
    expect(config.poweredByHeader).toBe(false);
    expect(config.reactStrictMode).toBe(true);
    expect(config.typescript?.ignoreBuildErrors).toBe(false);
  });
});

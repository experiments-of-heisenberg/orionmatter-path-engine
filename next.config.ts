import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  // The offline demo reads recorded model answers from disk at run time. Next only ships files it can see being
  // imported, so say outright that every API route needs the fixtures folder (without this a deployed demo build finds none).
  outputFileTracingIncludes: { "/api/**/*": ["./src/fixtures/**/*"] },
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]);
  },
};

export default config;

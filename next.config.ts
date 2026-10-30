import type { NextConfig } from "next";

// Cache Components is deliberately off: every page here is per-user, request-time
// data behind auth, so the static-shell model adds complexity without benefit.

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  // Narrow CSP that cannot break Next's inline scripts: no <base> hijacking, no
  // plugins, no framing.
  { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

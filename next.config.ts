import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer (used in the SOA PDF route handlers) bundles fontkit and
  // other Node libs — keep it external so the server build doesn't choke on it.
  serverExternalPackages: ["@react-pdf/renderer"],
  // The Shift Schedule page was renamed to Calendar (route /shift-schedule →
  // /calendar). Keep old bookmarks/links working; the query string (branch,
  // view, scale, day, week) is forwarded automatically.
  async redirects() {
    return [
      { source: "/shift-schedule", destination: "/calendar", permanent: true },
    ];
  },
};

export default nextConfig;

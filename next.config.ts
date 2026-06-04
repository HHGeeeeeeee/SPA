import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer (used in the SOA PDF route handlers) bundles fontkit and
  // other Node libs — keep it external so the server build doesn't choke on it.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;

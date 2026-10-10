import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // FalkorDB speaks the Redis protocol via node-redis. These packages use
  // Node builtins (net/tls) that must NOT be bundled by Turbopack — bundling
  // them breaks BigInt handling at build time. Keep them external.
  serverExternalPackages: ["falkordb", "redis", "@redis/client"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

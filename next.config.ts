import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The Claude-vs-Codex report bake-off pages merged into /reports.
    return [
      { source: "/testc", destination: "/reports", permanent: false },
      { source: "/testC", destination: "/reports", permanent: false },
      { source: "/testO", destination: "/reports", permanent: false },
      { source: "/testo", destination: "/reports", permanent: false },
    ];
  },
};

export default nextConfig;

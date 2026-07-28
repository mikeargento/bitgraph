import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/overview", destination: "/docs/overview", permanent: true },
      { source: "/docs", destination: "/docs/overview", permanent: true },
      // The explainer's early per-orientation URLs; one responsive page now.
      { source: "/camera/desktop", destination: "/camera", permanent: false },
      { source: "/camera/mobile", destination: "/camera", permanent: false },
      // The uses page was briefly live under two earlier names on 2026-07-27
      // while the label was being settled. Both were deployed, so they redirect
      // rather than 404 for anyone who copied a link in that window.
      { source: "/solutions", destination: "/uses", permanent: true },
      { source: "/applications", destination: "/uses", permanent: true },
    ];
  },
};

export default nextConfig;

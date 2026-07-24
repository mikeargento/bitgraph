import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/overview", destination: "/docs/overview", permanent: true },
      { source: "/docs", destination: "/docs/overview", permanent: true },
      // The explainer's early per-orientation URLs; one responsive page now.
      { source: "/camera/desktop", destination: "/camera", permanent: false },
      { source: "/camera/mobile", destination: "/camera", permanent: false },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/overview", destination: "/docs/overview", permanent: true },
      { source: "/docs", destination: "/docs/overview", permanent: true },
    ];
  },
  async rewrites() {
    // Clean URLs for the static "A Camera for Bits" explainer pages in
    // public/camera/ (unlisted; shared by direct link). /camera itself is a
    // tiny detector page that forwards to the right orientation.
    return [
      { source: "/camera", destination: "/camera/index.html" },
      { source: "/camera/desktop", destination: "/camera/desktop.html" },
      { source: "/camera/mobile", destination: "/camera/mobile.html" },
    ];
  },
};

export default nextConfig;

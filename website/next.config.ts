import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // JSX <style>{`...`}</style> blocks are opaque strings to the bundler, so
  // unlike real CSS files they ship to production with their comments and
  // indentation intact — in the prerendered HTML and, for client components,
  // a second time in the JS chunk. This loader minifies those blocks at
  // build time; the commented CSS stays in the source files, which are the
  // documentation of record.
  turbopack: {
    rules: {
      "*.tsx": {
        loaders: ["./scripts/minify-style-blocks-loader.js"],
      },
    },
  },
  async redirects() {
    // 2026-10-17 (Mike: "turn off and strip away everything on the site that
    // isnt just this"): the site is the primitive, the proof pages, one page on
    // how it works, and the ledger. Every retired page redirects; none of these
    // is permanent, because browsers keep a permanent redirect forever and the
    // site is still settling. /docs went to /docs/overview PERMANENTLY until
    // today, so browsers that saw it go there first: the one docs page lives at
    // /how-it-works and every docs address lands on it, so no cached hop loops.
    const home = "/";
    const docs = "/how-it-works";
    return [
      { source: "/docs", destination: docs, permanent: false },
      { source: "/docs/:path*", destination: docs, permanent: false },
      { source: "/api-reference", destination: docs, permanent: false },
      { source: "/overview", destination: docs, permanent: false },
      { source: "/spec", destination: docs, permanent: false },
      { source: "/ledger/:path+", destination: "/ledger", permanent: false },
      { source: "/roll", destination: "/ledger", permanent: false },
      { source: "/rolls", destination: "/ledger", permanent: false },
      ...[
        "/generate", "/generate/:path*", "/jev", "/benchmark", "/ceilings", "/ceilings/:path*", "/contact", "/deck",
        "/fuse", "/subjects", "/uses", "/why", "/solutions", "/applications", "/image", "/portrait", "/painting",
        "/exam", "/three", "/bridge", "/declare", "/actor", "/folder", "/camera", "/camera/:path*", "/floors", "/try",
      ].map((source) => ({ source, destination: home, permanent: false })),
    ];
  },
};

export default nextConfig;

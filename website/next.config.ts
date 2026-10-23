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
    // 2026-10-17 (Mike): the site is one page, plus the ledger and the proof pages
    // ("this can literally be one page if you dont count ledger"). Every retired page
    // redirects home; none of these is permanent, because browsers keep a permanent
    // redirect forever and the site is still settling. /docs went to /docs/overview
    // PERMANENTLY until today; both now land on /, which redirects nowhere, so no
    // cached hop loops.
    const home = "/";
    // the old docs addresses land on Tools (2026-10-18: Docs became Tools; the home page is the explanation)
    const docs = "/tools";
    return [
      { source: "/docs", destination: docs, permanent: false },
      { source: "/how-it-works", destination: home, permanent: false },
      { source: "/docs/:path+", destination: docs, permanent: false },
      { source: "/api-reference", destination: docs, permanent: false },
      { source: "/overview", destination: docs, permanent: false },
      { source: "/spec", destination: docs, permanent: false },
      // every old ledger address goes to the ledger, except its calendar
      { source: "/ledger/:path((?!calendar$).+)", destination: "/ledger", permanent: false },
      { source: "/roll", destination: "/ledger", permanent: false },
      { source: "/rolls", destination: "/ledger", permanent: false },
      ...[
        "/generate/:path+", "/benchmark", "/ceilings", "/ceilings/:path*", "/deck",
        "/fuse", "/subjects", "/uses", "/why", "/solutions", "/applications", "/image", "/portrait", "/painting",
        "/three", "/bridge", "/declare", "/actor", "/folder", "/camera", "/camera/:path*", "/floors", "/try",
      ].map((source) => ({ source, destination: home, permanent: false })),
    ];
  },
};

export default nextConfig;

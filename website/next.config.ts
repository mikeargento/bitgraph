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
  async headers() {
    // The pointer's models (public/trustmark) are checked against their SHA-256 on load (lib/trustmark/models.ts), and a
    // changed model ships under a new file name, so a browser keeps them for a year instead of asking again each visit.
    return [{ source: "/trustmark/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
  async redirects() {
    // 2026-10-17: the site is one page, plus the ledger and the proof pages, since
    // everything else fits on the home page. Every retired page
    // redirects home; none of these is permanent, because browsers keep a permanent
    // redirect forever and the site is still settling. /docs went to /docs/overview
    // PERMANENTLY until today; both now land on /, which redirects nowhere, so no
    // cached hop loops.
    const home = "/";
    // the old docs addresses land on Tools (2026-10-18: Docs became Tools; the home page is the explanation)
    const docs = "/tools";
    return [
      // Make folded into Proofs, where a drop is checked first and made with one press
      { source: "/make", destination: "/ledger", permanent: false },
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

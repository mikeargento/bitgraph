import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

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
  // Development only: a local server cannot read the proof store, so proof lookups go to the live site. Lookups only;
  // nothing that makes a BitGraph is forwarded.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return {
      beforeFiles: [
        { source: "/api/proofs/:path*", destination: "https://bitgraph.ing/api/proofs/:path*" },
        { source: "/api/tree-members", destination: "https://bitgraph.ing/api/tree-members" },
        { source: "/api/publication", destination: "https://bitgraph.ing/api/publication" },
      ],
      afterFiles: [],
      fallback: [],
    };
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
    const docs = "/how";
    return [
      // Watermarks, then Find, became Check, which looks up any file and finds a copy's original by its looks
      { source: "/watermarks", destination: "/demos", permanent: false },
      { source: "/find", destination: "/demos", permanent: false },
      { source: "/docs", destination: docs, permanent: false },
      // Pages that moved into the sections of the documentation site (2026-11-25)
      { source: "/pictures", destination: "/examples/copies", permanent: false },
      { source: "/tools", destination: "/how", permanent: false },
      { source: "/integrate/reference", destination: "/how", permanent: false },
      { source: "/how/atomic", destination: "/how/mechanism", permanent: false },
      { source: "/how/publication", destination: "/how/time", permanent: false },
      { source: "/how/without-disclosure", destination: "/how/collections", permanent: false },
      { source: "/how/verification", destination: "/how/proof", permanent: false },
      { source: "/how/enclave", destination: "/how/trust", permanent: false },
      { source: "/how/threat-model", destination: "/how/trust", permanent: false },
      { source: "/licensing/use-cases", destination: "/use-cases", permanent: false },
      { source: "/evaluate", destination: "/integrate/evaluate", permanent: false },
      { source: "/applications", destination: "/use-cases", permanent: false },
      // The explanation is How it works, one topic to a page (2026-11-25)
      { source: "/how-it-works", destination: "/how", permanent: false },
      { source: "/technology", destination: "/how", permanent: false },
      { source: "/docs/:path+", destination: docs, permanent: false },
      { source: "/api-reference", destination: docs, permanent: false },
      { source: "/overview", destination: docs, permanent: false },
      { source: "/spec", destination: docs, permanent: false },
      { source: "/roll", destination: "/ledger", permanent: false },
      { source: "/rolls", destination: "/ledger", permanent: false },
      ...[
        "/generate/:path+", "/benchmark", "/ceilings", "/ceilings/:path*", "/deck",
        "/fuse", "/subjects", "/uses", "/why", "/solutions", "/image", "/portrait", "/painting",
        "/three", "/bridge", "/declare", "/actor", "/folder", "/camera", "/camera/:path*", "/floors", "/try",
      ].map((source) => ({ source, destination: home, permanent: false })),
    ];
  },
};

export default createMDX()(nextConfig);

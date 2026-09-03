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
    return [
      { source: "/overview", destination: "/docs/overview", permanent: true },
      // The Roll became the Ledger on 2026-09-03: a photography word for an
      // audience that is now developers. Every old path keeps working, because
      // proof pages, the docs and anything anyone bookmarked point at these.
      // Permanent: the new names are settled, unlike the /uses experiment below.
      { source: "/roll", destination: "/ledger", permanent: true },
      { source: "/rolls", destination: "/ledger/archive", permanent: true },
      { source: "/api/roll/head", destination: "/api/ledger/head", permanent: true },
      // The buyer's room, renamed twice on 2026-08-02: "Uses" (SaaS taxonomy)
      // → "Why" (vague, and an interrogative among nouns) → "Subjects" (what
      // you point the camera at; parallel with Roll and Docs, and the page is
      // organized by subject). Both old routes stay alive. TEMPORARY (307) on
      // purpose: /uses shipped as a 308 earlier tonight and browsers cache
      // those indefinitely, so while the name is still settling these must not
      // bake in another permanent entry. Make them permanent once it holds.
      { source: "/uses", destination: "/subjects", permanent: false },
      { source: "/why", destination: "/subjects", permanent: false },
      // /declare shipped 2026-08-18 and was renamed to /actor the next day,
      // when the feature settled on its name (the word is the protocol's own:
      // agency.actor, actorKeyId). TEMPORARY like the others: the name is a
      // day old and a 308 would bake into caches indefinitely.
      { source: "/declare", destination: "/actor", permanent: false },
      { source: "/docs", destination: "/docs/overview", permanent: true },
      // The /folder browser was removed 2026-08-07; the Folder's page is its
      // docs story. TEMPORARY like the others while names settle.
      { source: "/folder", destination: "/docs/folder", permanent: false },
      // The explainer moved to the top of /docs/overview (2026-08-06); the
      // standalone page is gone. TEMPORARY (307) like /uses: a 308 bakes into
      // browser caches indefinitely, so it stays 307 until the home settles.
      { source: "/camera", destination: "/docs/overview", permanent: false },
      { source: "/camera/desktop", destination: "/docs/overview", permanent: false },
      { source: "/camera/mobile", destination: "/docs/overview", permanent: false },
      // The uses page was briefly live under two earlier names on 2026-07-27
      // while the label was being settled. Both were deployed, so they redirect
      // rather than 404 for anyone who copied a link in that window.
      { source: "/solutions", destination: "/uses", permanent: true },
      { source: "/applications", destination: "/uses", permanent: true },
    ];
  },
  async headers() {
    return [
      // The deck is a targeted pitch page (src/app/deck), hosted UNLINKED
      // on purpose: reachable by URL so it can be sent to the people it is
      // for, never linked from any page on the site, kept out of indexes
      // (belt to the page metadata's own robots suspenders).
      { source: "/deck", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;

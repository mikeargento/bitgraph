import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/overview", destination: "/docs/overview", permanent: true },
      // The buyer's room, renamed twice on 2026-08-02: "Uses" (SaaS taxonomy)
      // → "Why" (vague, and an interrogative among nouns) → "Subjects" (what
      // you point the camera at; parallel with Roll and Docs, and the page is
      // organized by subject). Both old routes stay alive. TEMPORARY (307) on
      // purpose: /uses shipped as a 308 earlier tonight and browsers cache
      // those indefinitely, so while the name is still settling these must not
      // bake in another permanent entry. Make them permanent once it holds.
      { source: "/uses", destination: "/subjects", permanent: false },
      { source: "/why", destination: "/subjects", permanent: false },
      { source: "/docs", destination: "/docs/overview", permanent: true },
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
};

export default nextConfig;

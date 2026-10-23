import type { MetadataRoute } from "next";

const BASE = "https://bitgraph.ing";

/* Every public route once (2026-10-17: the site is the primitive and nothing
   else). Proof pages are unbounded and found by hash, so they are not listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/make", "/tools", "/ledger", "/ledger/calendar", "/terms", "/privacy"].map((path) => ({ url: `${BASE}${path}` }));
}

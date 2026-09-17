import type { MetadataRoute } from "next";
import { DOCS_SECTIONS } from "@/lib/docs-sections";

const BASE = "https://bitgraph.ing";

/* Every public route once. Documentation sections come from the same list the
   menu reads. /deck is unlisted and noindexed; /docs/folder is a noindexed
   retirement notice; /fuse is gated; proof pages are unbounded. */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ["", "/ledger/archive", "/mcp", "/terms", "/privacy", "/contact"];
  const paths = Array.from(new Set([...staticRoutes, ...DOCS_SECTIONS.map((s) => s.href)]));
  return paths.map((path) => ({ url: `${BASE}${path}` }));
}

import type { MetadataRoute } from "next";
import { DOCS_SECTIONS } from "@/lib/docs-sections";

const BASE = "https://bitgraph.ing";

/* The public routes, one line each. Docs come from the same list the nav
   reads, so a new section is in the sitemap the moment it is in the menu.
   /deck is deliberately absent: it is noindexed, the door stays unlisted.
   /proof pages are unbounded and reachable from the Roll, so they are not
   enumerated here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ["", "/roll", "/rolls", "/actor", "/integrations", "/api-reference", "/mcp", "/terms", "/privacy", "/refunds", "/contact"];
  const docs = DOCS_SECTIONS.map((s) => s.href);
  return [...staticRoutes, ...docs].map((path) => ({
    url: `${BASE}${path}`,
  }));
}

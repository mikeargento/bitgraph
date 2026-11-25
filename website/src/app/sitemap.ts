import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const BASE = "https://bitgraph.ing";

/* Every public page once: the pages in content/docs, then the pages that do work. Proof pages are unbounded and found
   by hash, so they are not listed. */
const APP_PAGES = ["/demos", "/ledger", "/ledger/calendar", "/jev", "/generate", "/exam", "/contact"];

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((p) => p.url);
  return [...docs, ...APP_PAGES].map((path) => ({ url: `${BASE}${path === "/" ? "" : path}` }));
}

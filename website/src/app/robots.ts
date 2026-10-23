import type { MetadataRoute } from "next";

/* Everything is crawlable; /deck stays out of the index via its own noindex
   metadata rather than a robots block, so the tag can be read. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://bitgraph.ing/sitemap.xml",
  };
}

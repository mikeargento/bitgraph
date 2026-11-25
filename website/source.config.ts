import { defineConfig, defineDocs } from "fumadocs-mdx/config";

/** The site's pages, as MDX in content/docs: each file is a page, folders are sections, meta.json orders them. */
export const docs = defineDocs({ dir: "content/docs" });

export default defineConfig();

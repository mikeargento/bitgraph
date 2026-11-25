import { loader } from "fumadocs-core/source";
import { docs } from "../../.source/server";

/** The site's pages (content/docs, as MDX), served from the site root: content/docs/how/time.mdx is /how/time. */
export const source = loader({ baseUrl: "/", source: docs.toFumadocsSource() });

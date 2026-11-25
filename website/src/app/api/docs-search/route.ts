import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

/** Search over the site's pages, for the search box in the frame. (/api/search is the proof lookup.) */
export const { GET } = createFromSource(source);

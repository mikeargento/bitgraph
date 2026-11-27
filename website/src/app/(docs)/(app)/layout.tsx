import { DocsPage } from "fumadocs-ui/layouts/docs/page";
import { SiteFoot } from "@/components/site-foot";

/** The pages that do work (making a BitGraph, the ledger, the demos that run, proofs, Contact's form), in the same
 *  frame and column as the rest, with no table of contents, and with the previous and next links of their place in the
 *  sidebar. Each page prints its own title. */
export default function AppPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsPage tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }}>
      <div className="app-page">{children}</div>
      <SiteFoot />
    </DocsPage>
  );
}

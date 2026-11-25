import { DocsPage } from "fumadocs-ui/layouts/docs/page";

/** The pages that do work (making a BitGraph, the ledger, the demos that run, proofs, Contact's form), in the same
 *  frame and column as the rest, with no table of contents. Each page prints its own title. */
export default function AppPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsPage tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }} footer={{ enabled: false }}>
      <div className="app-page">{children}</div>
    </DocsPage>
  );
}

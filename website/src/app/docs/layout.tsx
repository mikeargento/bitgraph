/**
 * The docs reading column, and nothing else.
 *
 * It used to open with a sticky, full-width section menu. That menu was a
 * button the width of the reading column whose label repeated the page's own
 * h1 eight pixels beneath it, on a site whose standing rule is no buttons, and
 * it pushed every document down by its height. The section list moved into the
 * site nav (see `components/site-nav.tsx`), which is sticky already, so nothing
 * is lost from deep in a long page and the docs now start with their heading.
 *
 * The sections themselves, and the reasoning behind their order, live in
 * `lib/docs-sections.ts`.
 *
 * What it does add is the previous/next pair at the foot of the column. It
 * belongs here rather than in fifteen pages: the layout wraps every docs route,
 * and the component works out where it is from the pathname. A docs route that
 * is not a listed section renders nothing.
 */
import { DocsPageNav } from "@/components/docs-page-nav";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    // 40px, matching /subjects. It was 32px, which read as docs starting
    // tighter to the nav than the rest of the site; the difference only became
    // visible once the section bar stopped occupying that space.
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
      {children}
      <DocsPageNav />
    </div>
  );
}

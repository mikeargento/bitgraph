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
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "32px 0 80px" }}>
      {children}
    </div>
  );
}

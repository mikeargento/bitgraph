"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_SECTIONS } from "@/lib/docs-sections";

/**
 * The pair of links at the foot of every docs page.
 *
 * They carry the adjacent sections' own names, never "Previous" and "Next":
 * the point is that the bottom of a page tells you where you are in the docs,
 * which two anonymous doors cannot do. Order comes from DOCS_SECTIONS, the
 * same list the nav menu renders, so the trail and the menu cannot drift.
 *
 * Rendered once by the docs layout rather than by fifteen pages. /subjects is
 * the exception: it is in the sequence but lives outside /docs, so that page
 * mounts this itself.
 *
 * GitHub is not in the sequence. It is a destination, not a section, so the
 * trail ends at FAQ.
 *
 * Styling is .bg-action-link, the site's one link idiom (blue label, arrow, no
 * chrome), so this introduces no new treatment. The only addition is the back
 * arrow, which travels left on hover instead of right.
 */
export function DocsPageNav() {
  const pathname = usePathname();
  const i = DOCS_SECTIONS.findIndex((s) => s.href === pathname);
  // A docs route that is not a listed section (or a stray render) gets nothing
  // rather than a wrong neighbour.
  if (i === -1) return null;

  const prev = i > 0 ? DOCS_SECTIONS[i - 1] : null;
  const next = i < DOCS_SECTIONS.length - 1 ? DOCS_SECTIONS[i + 1] : null;
  if (!prev && !next) return null;

  return (
    <nav aria-label="Docs sections" className="bg-page-nav">
      {/* Overview has no previous. The empty span holds the left half so the
          lone Use cases link still sits on the right, where a forward link
          belongs. */}
      {prev ? (
        <Link href={prev.href} className="bg-action-link back" rel="prev">
          <span className="arrow">&larr;</span> {prev.label}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="bg-action-link" rel="next">
          {next.label} <span className="arrow">&rarr;</span>
        </Link>
      )}
    </nav>
  );
}

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
/* `current`: which section this page IS, when the URL does not say. Home
   renders the overview at "/", so it passes "/docs/overview" and gets the
   overview's pair; without it the trail was missing from the home page
   (Mike, 2026-09-09: "the links at bottom of overview page got lost when
   moved to homepage"). Every docs route still reads its own pathname. */
/** Google's arrow (Material "arrow_forward"): a stem and an open head, drawn at 20px. */
function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg className="arrow" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={back ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One pill size for every page (Mike, 2026-09-29: "they should all be uniform
 * in size and be the size of the largest needed size"). The pill is a
 * one-cell grid: the visible arrow and name sit centred, and behind them, in
 * the same cell, an invisible arrow-and-name row for EVERY section. The cell
 * is as wide as the widest of those in whatever font rendered, so no width is
 * hard-coded and a new section resizes every pill by itself. Phones drop the
 * sizers and split the row in equal halves (globals.css).
 */
function Rows({ text, back }: { text: string; back?: boolean }) {
  const row = (label: string) => (back ? <><Arrow back /><span>{label}</span></> : <><span>{label}</span><Arrow /></>);
  return (
    <>
      <span className="bg-pn-row">{row(text)}</span>
      {DOCS_SECTIONS.map((s) => (
        <span key={s.href} className="bg-pn-row bg-pn-sizer" aria-hidden="true">{row(s.label)}</span>
      ))}
    </>
  );
}

export function DocsPageNav({ current }: { current?: string } = {}) {
  const pathname = usePathname();
  const i = DOCS_SECTIONS.findIndex((s) => s.href === (current ?? pathname));
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
        <Link href={prev.href} className="bg-action-link back bg-pn" rel="prev">
          <Rows text={prev.label} back />
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="bg-action-link bg-pn" rel="next">
          <Rows text={next.label} />
        </Link>
      )}
    </nav>
  );
}

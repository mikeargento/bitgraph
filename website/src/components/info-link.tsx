import Link from "next/link";

/* ── The info link: a circled i, brand blue, that goes to the page that
   explains the thing it sits beside. Home's title row ("What is a BitGraph")
   and /actor's register screen ("How it works") wear it.

   A glyph, where the site otherwise uses words, because of where it sits: the
   right of a title row, beside a 34..40px title, where on a phone any label
   longer than about 60px wraps under the title (Mike, 2026-08-19: "wrapping
   button is bad should it just be an i with a circle info symbol???"). Info
   is the one kind of link a glyph can say whole; actions keep their words.
   Drawn like the site's other glyphs (the row chevrons, the arrows): stroke,
   square caps, no fill. The hit area is grown the way .bg-arrow-link grows
   its own, padding cancelled in layout, so a tap near it lands. ── */
export function InfoLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="bg-info-link"
      style={{ display: "inline-flex", alignItems: "center", color: "#0065A4", padding: 10, margin: -10, flexShrink: 0, alignSelf: "center" }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 11 L12 16.5" />
        <path d="M12 7.5 L12 8.5" />
      </svg>
    </Link>
  );
}

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
      {/* Drawn the way the recognisable one is drawn: a THIN ring and a bold,
          generous i with a real dot. The first cut had a 2px ring and
          a 5px stem inside 22px and read as a tick, then as "a line" (Mike).
          The ring is furniture; the i is the sign, so the i gets the weight:
          stem about a third of the ring's height, dot a clear disc. 28px,
          which is the cap height of the 40px title it sits beside; 24 read a
          touch small there, 32 a touch big. */}
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="butt" strokeLinejoin="miter" aria-hidden="true">
        <circle cx="12" cy="12" r="10.25" strokeWidth="1.5" />
        <circle cx="12" cy="7.3" r="1.55" fill="currentColor" stroke="none" />
        <path d="M12 10.4 L12 17.8" strokeWidth="2.9" />
      </svg>
    </Link>
  );
}

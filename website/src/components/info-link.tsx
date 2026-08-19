import Link from "next/link";

/* ── The info link: the words that go to the page explaining the thing they
   sit beside. Home's title row ("What is a BitGraph →") and /actor's register
   screen ("How it works →") wear it.

   Words, not a glyph. It was a circled i for an afternoon (2026-08-19), which
   never wrapped but was the site's one icon-only control and read as "a line"
   at the size the row allows; Mike: "what about info ->". So: the site's
   standard link type (14 / 600 / -0.01em, brand blue, the arrow), with the
   full words where there is room and "Info →" on a phone, where a 34px title
   leaves about 60px beside it (the .bg-long / .bg-short rule in globals, the
   same one the title-row actions use). Measured at 14/600: "Info →" is 41px;
   with the title rows' 12px phone gap it fits beside "A camera for bits"
   (264px) down to a 360px viewport. ── */
export function InfoLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="bg-arrow-link"
      style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}
    >
      <span className="bg-long">{label}</span><span className="bg-short">Info</span> <span className="arrow" aria-hidden="true">&rarr;</span>
    </Link>
  );
}

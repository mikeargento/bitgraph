/* The site footer: one row on the reading column, mirroring the nav. The
   entity at the left edge of the column, the legal links at the right.

   2026-09-11 (Mike): back onto the 90%/800px column with the nav, for the
   same reason (every page is the column now that the camera pane is gone).
   Two things were cut the same day: the centred "BitGraph™ is a trademark
   of Argento Computing Inc." (the © line names the company nine words
   earlier and Terms §8 states the mark) and the camera page's slim
   one-line variant for phones ("/" is a reading page now). With the middle
   chunk gone, the 1fr auto 1fr true-centring grid and its 820px stacking
   rule went too; the row simply wraps on a narrow phone.

   No top margin on the bar: with the body white (the grey belongs to main),
   a margin here rendered as a floating white strip above the hairline
   (Mike: "lose that white bar"); the reading column's own bottom padding
   provides the breathing room, in grey.

   History, 2026-08-27: "All rights reserved", "Patent pending", a contact
   email, a Security link, and a Refunds link were each here briefly and
   rejected; see project_company_site_2026_08_27. */

const links: Array<{ href: string; label: string }> = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/contact", label: "Contact" },
];

const linkStyle: React.CSSProperties = { color: "#0065A4", textDecoration: "none" };

export function SiteFooter() {
  // Computed at render, never hardcoded.
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        background: "var(--bar)",
        fontSize: 13,
        lineHeight: 1.8,
        color: "#4b5563",
      }}
    >
      <div className="bg-footer-inner">
        <div>© {year} Argento Computing Inc.</div>
        <div>
          {links.map((l, i) => (
            <span key={l.href}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <a href={l.href} style={linkStyle}>{l.label}</a>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}

/* The site footer: one row on the reading column, mirroring the nav. The
   entity at the left edge of the column, the legal links at the right.

   2026-09-11: back onto the 90%/800px column with the nav, for the
   same reason (every page is the column now that the camera pane is gone).
   Two things were cut the same day: the centred "BitGraph™ is a trademark
   of Argento Computing Inc." (the © line names the company nine words
   earlier and Terms §8 states the mark) and the camera page's slim
   one-line variant for phones ("/" is a reading page now). With the middle
   chunk gone, the 1fr auto 1fr true-centring grid and its 820px stacking
   rule went too; the row simply wraps on a narrow phone.

   No top margin on the bar: with the body white (the grey belongs to main),
   a margin here rendered as a floating white strip above the hairline;
   the reading column's own bottom padding
   provides the breathing room, in grey.

   History, 2026-08-27: "All rights reserved", "Patent pending", a contact
   email, a Security link, and a Refunds link were each here briefly and
   rejected; see project_company_site_2026_08_27. */


import { ThemeToggle } from "@/components/theme-toggle";

const links: Array<{ href: string; label: string }> = [
  // The source (2026-10-17): the site had no GitHub link, and the footer is its place.
  // Tools and Demos live in the bar; Contact (the form) lives here (2026-10-20).
  { href: "/contact", label: "Contact" },
  { href: "https://github.com/mikeargento/bitgraph", label: "GitHub" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

const linkStyle: React.CSSProperties = { color: "var(--accent)", textDecoration: "none" };

export function SiteFooter() {
  // Computed at render, never hardcoded.
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        background: "var(--bar)",
        fontSize: 13,
        lineHeight: 1.8,
        color: "var(--dim)",
      }}
    >
      <div className="bg-footer-inner">
        <div>© {year} Argento Computing Inc.</div>
        {/* Plain dim links with space between them, no dots or underlines (2026-10-18): the old footer looked dated. */}
        <div className="bg-footer-links">
          {links.map((l) => (
            <a key={l.href} href={l.href} style={linkStyle} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {})}>{l.label}</a>
          ))}
          {/* The sun/moon, at the footer's right on desks (2026-10-28); phones have it in the menu. */}
          <span className="bg-footer-theme"><ThemeToggle /></span>
        </div>
      </div>
    </footer>
  );
}

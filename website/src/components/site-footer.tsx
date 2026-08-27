/* The site footer, on every page. Added 2026-08-27 with the legal pages,
   which supersedes the 2026-08-06 "no footer" rule: the operating company
   (Argento Computing Inc.) now exists and the site must name it, carry the
   trademark and patent lines, and link the legal pages. One row spanning the
   page: entity left, trademark centre, links right; stacks on phones. No
   contact email here (Mike, 2026-08-27); it lives on the legal pages. */

const links: Array<{ href: string; label: string }> = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
  // The Resend form from June, restored 2026-08-27 in place of a footer
  // email address.
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  // Computed at render (build time for static pages, request time for
  // dynamic ones), never hardcoded.
  const year = new Date().getFullYear();
  return (
    <footer
      id="site-footer"
      style={{
        // The nav bar's surface, mirrored: white, same hairline, one row.
        background: "#ffffff",
        borderTop: "1px solid #e5e7eb",
        marginTop: 48,
        fontSize: 13,
        lineHeight: 1.8,
        color: "#4b5563",
      }}
    >
      <div className="bg-footer-inner">
        <div>© {year} Argento Computing Inc.</div>
        <div>BitGraph™ is a trademark of Argento Computing Inc.</div>
        <div>
          {links.map((l, i) => (
            <span key={l.href}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <a href={l.href} style={{ color: "#0065A4", textDecoration: "none" }}>
                {l.label}
              </a>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}

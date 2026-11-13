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




import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/** The reproducible build's pins: how to rebuild the enclave image and get the same PCR0. */
const PINS_URL = "https://github.com/mikeargento/bitgraph/blob/main/server/commit-service/reproducible-build/PINS.md";
/** The hourly publisher's address on Base: every write it has made. */
const WRITER_URL = "https://basescan.org/address/0xf3972408D853c975F86351C311f4310220bbF2a3";

const links: Array<{ href: string; label: string }> = [
  // The source (2026-10-17): the site had no GitHub link, and the footer is its place.
  // Demos is in the bar and on the home page, so it is not repeated here; Contact (the form) is.
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
        <div>
          <div>© {year} Argento Computing Inc.</div>
          {/* What the site runs on, stated plainly: the measured enclave by its image, and the hourly publication. */}
          {/* Each fact opens its evidence: the enclave in the mechanism, the image's measurement in the reproducible build, and
              every hourly write at the publisher's address on Base. */}
          <div className="bg-footer-facts">
            {/* A plain link, not next/link: on Home the page's own slide takes the click (SmoothAnchors). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/#t-attest">AWS Nitro enclave</a>
            {" \u00b7 "}
            <a href={PINS_URL} target="_blank" rel="noopener">{`PCR0 ${PUBLISHED_PCR0.slice(0, 12)}\u2026`}</a>
            {" \u00b7 "}
            <a href={WRITER_URL} target="_blank" rel="noopener">Published hourly on Base</a>
          </div>
        </div>
        {/* Plain dim links with space between them, no dots or underlines (2026-10-18): the old footer looked dated. */}
        <div className="bg-footer-links">
          {links.map((l) => (
            <a key={l.href} href={l.href} style={linkStyle} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {})}>{l.label}</a>
          ))}
        </div>
      </div>
    </footer>
  );
}

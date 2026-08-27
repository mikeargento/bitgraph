"use client";

import { usePathname } from "next/navigation";

/* The site footer, on every READING page. Added 2026-08-27 with the legal
   pages, which supersedes the 2026-08-06 "no footer" rule: the operating
   company (Argento Computing Inc.) now exists and the site must name it,
   carry the trademark line, and link the legal pages. One row spanning the
   page: entity left, trademark centre, links right; stacks on phones. No
   contact email here (Mike, 2026-08-27); it lives on the legal pages.

   NOT on the camera pages (home, /actor), Mike's call the same night: they
   are the app surface, viewport-fitted around the drop box, and the footer
   both competed with the shutter and re-broke the iPhone fit (WebKit sized
   the frame as if the bar were not there). The legal links live on every
   page where reading happens; the camera keeps its one link out. */

const CAMERA_PAGES = new Set(["/", "/actor"]);

const links: Array<{ href: string; label: string }> = [
  // Refunds lived here for a day (2026-08-27) and left with the subscription
  // tier: pricing is Free plus Enterprise-by-agreement, and an agreement
  // carries its own refund terms. Pricing leads: commercial before legal.
  // NOT in the Docs menu, which is the documentation's own contents.
  { href: "/pricing", label: "Pricing" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  // The Resend form from June, restored 2026-08-27 in place of a footer
  // email address.
  { href: "/contact", label: "Contact" },
];

/* The camera pages' own bar: one line, the entity, nothing else (Mike,
   2026-08-27: "JUST © 2026 Argento Computing Inc."). Height is a FIXED 40px
   so the camera-fit hook can subtract a constant instead of measuring a bar
   whose reflow broke the iPhone fit; the line cannot wrap at any viewport
   this site serves. Keep this height and CAMERA_BAR_PX in use-camera-fit.ts
   the same number. */
export const CAMERA_BAR_PX = 40;

export function SiteFooter() {
  const pathname = usePathname();
  // Computed at render, never hardcoded.
  const year = new Date().getFullYear();
  if (CAMERA_PAGES.has(pathname)) {
    /* Terms and Privacy ride along (2026-08-27): CalOPPA requires a
       conspicuous Privacy link on the homepage of a site that collects
       personal information (IP logs, fingerprints), and Terms notice is what
       makes the terms enforceable. The whole line stays under 320px at
       12.5px, so the bar still cannot wrap and the fixed height holds. */
    return (
      <footer
        id="site-footer"
        style={{
          background: "#ffffff",
          borderTop: "1px solid #e5e7eb",
          height: CAMERA_BAR_PX,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 12.5,
          color: "#4b5563",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ marginRight: 12 }}>© {year} Argento Computing Inc.</span>
        <a href="/terms" style={{ color: "#0065A4", textDecoration: "none" }}>Terms</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy" style={{ color: "#0065A4", textDecoration: "none" }}>Privacy</a>
      </footer>
    );
  }
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

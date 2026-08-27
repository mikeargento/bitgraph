"use client";

import { usePathname } from "next/navigation";

/* The site footer. Reading pages get the full bar (entity left, trademark
   true-centred, links right, one 56px row mirroring the nav, stacking below
   820). The camera pages (home, /actor) are responsive (Mike, 2026-08-27):
   phones get the slim one-line bar, whose FIXED 40px height is what the
   camera-fit hook subtracts as a constant (nothing measured, the WebKit
   iPhone bug class stays dead); from 820 up they get the same full bar as
   everywhere else, which fits exactly inside the 57px band the desktop
   centring already reserves at the bottom, so the fit math never changes.
   The toggle lives in CSS (globals: .bg-footer-camera-slim/-full).

   No top margin on the bar: with the body white (the grey belongs to main),
   a margin here rendered as a floating white strip above the hairline
   (Mike: "lose that white bar"); the reading column's own bottom padding
   provides the breathing room, in grey.

   History, same day: "All rights reserved", "Patent pending", a contact
   email, a Security link, and a Refunds link were each here briefly and
   rejected; see project_company_site_2026_08_27. */

const CAMERA_PAGES = new Set(["/", "/actor"]);

const links: Array<{ href: string; label: string }> = [
  { href: "/pricing", label: "Pricing" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/contact", label: "Contact" },
];

const linkStyle: React.CSSProperties = { color: "#0065A4", textDecoration: "none" };

export function SiteFooter() {
  const pathname = usePathname();
  // Computed at render, never hardcoded.
  const year = new Date().getFullYear();

  const fullBar = (
    <footer
      style={{
        background: "#ffffff",
        borderTop: "1px solid #e5e7eb",
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
              <a href={l.href} style={linkStyle}>{l.label}</a>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );

  if (CAMERA_PAGES.has(pathname)) {
    return (
      <>
        <footer className="bg-footer-camera-slim">
          <span style={{ marginRight: 12 }}>© {year} Argento Computing Inc.</span>
          <a href="/terms" style={linkStyle}>Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/privacy" style={linkStyle}>Privacy</a>
        </footer>
        <div className="bg-footer-camera-full">{fullBar}</div>
      </>
    );
  }

  return fullBar;
}

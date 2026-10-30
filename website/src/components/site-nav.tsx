"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The bar, in its own look (2026-10-17): the wordmark, then the links, Make at the right. The sun/moon left the bar for
 * the footer's bottom right (2026-10-20).
 * Demos joined the bar 2026-10-20, and Contact briefly with it before moving to the footer: on desks the links sit in
 * the bar; on phones they fold into a menu button that opens a sheet under the bar.
 */
const LINKS: Array<{ href: string; label: string; also?: string[] }> = [
  // The site sells the mechanism to companies that sell proof (2026-10-27): what it is, where it fits, how to build
  // on it, how to license it. Make, Check, the ledger and the demos are its evidence, under Try it.
  { href: "/technology", label: "Technology" },
  { href: "/applications", label: "Applications" },
  { href: "/integrate", label: "Integrate" },
  { href: "/licensing", label: "Licensing" },
  { href: "/tools", label: "Docs" },
  { href: "/ledger", label: "Ledger" },
  { href: "/evaluate", label: "Evaluate" },
];
// The button is the one action a visitor should take: Try it, where a drop proves the product in a minute.
const CTA = { href: "/demos", label: "Try it", also: ["/make", "/jev", "/generate", "/exam"] };

export function SiteNav() {
  const pathname = usePathname();
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = (href: string, also: string[] = []) => (on(href) || also.some(on) ? "page" : undefined);
  // Phones: the links fold into a menu under the bar; a new page closes it.
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  // the page under the open menu stays still, and Esc closes it
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", key); };
  }, [open]);


  return (
    <div id="site-nav" style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* The record dot tried beside the wordmark and removed the same day (2026-10-20). */}
        <Link href="/" className="nav-wordmark" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-btn nav-box nav-desk" aria-current={current(l.href, l.also)} style={{ textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
          {/* The bar is the links and the one button; the sun/moon lives in the footer, on every screen (2026-10-28). */}
          <Link href={CTA.href} className="nav-cta-sx" aria-current={current(CTA.href)}>{CTA.label}</Link>
        </nav>
        <button type="button" className="nav-menu-btn" aria-label={open ? "Close the menu" : "Open the menu"} aria-expanded={open} aria-controls="nav-sheet" onClick={() => setOpen((o) => !o)}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            {open
              ? <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              : <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
          </svg>
        </button>
      </div>
      {open && (
        <nav id="nav-sheet" aria-label="Site" className="nav-sheet">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-sheet-link" aria-current={current(l.href, l.also)} onClick={() => setOpen(false)}>{l.label}</Link>
          ))}
          <Link href={CTA.href} className="nav-sheet-link" aria-current={current(CTA.href)} onClick={() => setOpen(false)}>{CTA.label}</Link>
        </nav>
      )}
    </div>
  );
}

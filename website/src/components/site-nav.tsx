"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The bar, in its own look (2026-10-17): the wordmark, the ledger (the site is one page plus it),
 * styled as the old menu's buttons, and the square blue + that goes to the drop
 * box (it went to /docs/try before the site was cut to the primitive). The four
 * dropdown groups and the phone sheet went with the pages they led to; two
 * links fit a phone without a sheet.
 */
const LINKS: Array<{ href: string; label: string }> = [
  { href: "/ledger", label: "Ledger" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <div id="site-nav" style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link href="/" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-btn" aria-current={pathname === l.href ? "page" : undefined} style={{ textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
          <a href="/make" className="nav-cta nav-plus" aria-label="Make a BitGraph" title="Make a BitGraph">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </a>
        </nav>
      </div>
    </div>
  );
}

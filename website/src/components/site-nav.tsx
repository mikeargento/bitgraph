"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The bar, in its own look (2026-10-17): the wordmark, then two outlined buttons, Make (the drop
 * box and the API, /make) and Check (the ledger: look a file up, or read every BitGraph by day). The
 * + that went to the drop box gave way to them (Mike, 2026-10-17: "2 buttons in the top: make and check"). The four
 * dropdown groups and the phone sheet went with the pages they led to; two
 * links fit a phone without a sheet.
 */
const LINKS: Array<{ href: string; label: string }> = [
  // Check is the ledger: look a file up, or read every BitGraph by day (Mike, 2026-10-17: "check is ledger").
  { href: "/ledger", label: "Ledger" },
  { href: "/docs", label: "Docs" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <div id="site-nav" style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link href="/" className="nav-wordmark" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-btn nav-box" aria-current={pathname === l.href || pathname.startsWith(l.href + "/") ? "page" : undefined} style={{ textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
          {/* The drop box, as a plus like before (Mike, 2026-10-17: "just a plus button like before?"): no box, no word. */}
          <Link href="/make" className="nav-plus-plain" aria-label="Make or check a BitGraph" title="Make or check a BitGraph" aria-current={pathname === "/make" ? "page" : undefined}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </div>
  );
}

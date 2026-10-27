"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The bar, in its own look (2026-10-17): the wordmark, then the links, Make at the right. The sun/moon left the bar for
 * the footer's bottom right (2026-10-20).
 * Demos joined the bar 2026-10-20, and Contact briefly with it before moving to the footer: on desks the links sit in
 * the bar; on phones they fold into a menu button that opens a sheet under the bar.
 */
const LINKS: Array<{ href: string; label: string }> = [
  // Proofs: drop a file to check it or make its BitGraph, and read every BitGraph by day (Make folded in here).
  { href: "/ledger", label: "Proofs" },
  { href: "/demos", label: "Demos" },
  { href: "/tools", label: "Tools" },
];

export function SiteNav() {
  const pathname = usePathname();
  const current = (href: string) => (pathname === href || pathname.startsWith(href + "/") ? "page" : undefined);


  return (
    <div id="site-nav" style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* The record dot tried beside the wordmark and removed the same day (2026-10-20). */}
        <Link href="/" className="nav-wordmark" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-btn nav-box nav-desk" aria-current={current(l.href)} style={{ textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
          {/* The sun/moon, upper right again (2026-10-21). */}
          <ThemeToggle />
        </nav>
      </div>
    </div>
  );
}

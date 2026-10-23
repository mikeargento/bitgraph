"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The bar, in its own look (2026-10-17): the wordmark, then the links, Make at the right. The sun/moon left the bar for
 * the footer's bottom right (Mike, 2026-10-20: "sun moon should now leave header enter footer bottom right").
 * Demos joined the bar 2026-10-20 (Mike: "we need demos and contact in the menu. the mobile site can have a hamburger";
 * then "remove contact from main nav and put in the footer"): on desks the links sit in the bar; on phones they fold
 * into a menu button that opens a sheet under the bar.
 */
const LINKS: Array<{ href: string; label: string }> = [
  { href: "/demos", label: "Demos" },
  // The ledger: look a file up, or read every BitGraph by day (Mike, 2026-10-17: "check is ledger").
  { href: "/ledger", label: "Proofs" },
  { href: "/tools", label: "Tools" },
  // Make on the right, plain text like the others (Mike, 2026-10-18 / 10-19).
  { href: "/make", label: "Make" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = (href: string) => (pathname === href || pathname.startsWith(href + "/") ? "page" : undefined);

  // The sheet closes when a link is followed, and on Escape.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div id="site-nav" style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* The record dot tried beside the wordmark and removed the same day (Mike, 2026-10-20). */}
        <Link href="/" className="nav-wordmark" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-btn nav-box nav-desk" aria-current={current(l.href)} style={{ textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
          {/* The sun/moon, upper right again (Mike, 2026-10-21: "moon sun at top again in nav in upper right"). */}
          <ThemeToggle />
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? "Close menu" : "Menu"}
            aria-expanded={open}
            aria-controls="nav-sheet"
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </nav>
      </div>
      {open && (
        <nav id="nav-sheet" aria-label="Site" className="nav-sheet">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-sheet-link" aria-current={current(l.href)} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

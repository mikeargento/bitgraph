// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";

/**
 * The bar (2026-10-17, the site stripped to the primitive): the wordmark and
 * the two pages there are. The four dropdown groups, the phone sheet and the
 * blue + went with the pages they led to.
 */
const LINKS: Array<{ href: string; label: string }> = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/ledger", label: "Ledger" },
];

export function SiteNav() {
  return (
    <div id="site-nav" style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link href="/" style={{ fontSize: 19, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} style={{ fontSize: 16, color: "var(--ink)", textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

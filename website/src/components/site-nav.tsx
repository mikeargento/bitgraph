"use client";

import Link from "next/link";

export function SiteNav() {
  return (
    <div id="site-nav" style={{
      borderBottom: "none",
      background: "#f5f5f5",
      position: "sticky", top: 0, zIndex: 50,
    }}>
      <div style={{
        width: "90%", maxWidth: 800, margin: "0 auto", padding: 0,
        height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <Link
          href="/"
          onClick={(e) => {
            // On the home route a same-route Link click won't reset the
            // results/exporting state, so force a fresh load back to the drop view.
            if (typeof window !== "undefined" && window.location.pathname === "/") {
              e.preventDefault();
              window.location.assign("/");
            }
          }}
          style={{
            fontSize: 24, fontWeight: 900, color: "#111827",
            textDecoration: "none", letterSpacing: "-0.02em",
            WebkitTextStroke: "0.4px #111827",
          }}
        >
          BitGraph
        </Link>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <Link href="/stats" style={{
            fontSize: 14, fontWeight: 600, color: "#111827",
            textDecoration: "none",
          }}>
            Stats
          </Link>
          <Link href="/docs" style={{
            fontSize: 14, fontWeight: 600, color: "#111827",
            textDecoration: "none",
          }}>
            Docs
          </Link>
          <a
            href="https://github.com/mikeargento/bitgraph"
            target="_blank"
            rel="noopener"
            style={{
              fontSize: 14, fontWeight: 600, color: "#111827",
              textDecoration: "none",
            }}
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

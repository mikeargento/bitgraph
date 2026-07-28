"use client";

import Link from "next/link";
import { warm, ROLL_FEED_KEY } from "@/lib/warm";

// Warm the Roll feed the moment the user signals intent to open it, so the page
// paints filled-in instead of spinning. Fires on hover / focus / touch — only
// when there's real intent, never on every page load — and is a no-op once a
// fresh copy is in flight or cached. Next already prefetches the route CODE on
// hover; this brings the DATA, the actual latency.
const warmRoll = () => warm(ROLL_FEED_KEY);

export function SiteNav() {
  return (
    // White bar on the off-white page, so the nav reads as its own band instead
    // of dissolving into the content. The rule underneath is deliberately the
    // PAGE background colour, not a border colour: over open page it is the
    // same value on both sides and therefore invisible, and it only resolves
    // into a visible hairline where a white card scrolls up beneath the sticky
    // bar, which is the one moment separation is needed. A darker rule (the
    // #e5e7eb footer divider, or worse the #d0d5dd card border) would draw a
    // permanent line across every page and make the bar read as a card.
    <div id="site-nav" style={{
      borderBottom: "1px solid #f5f5f5",
      background: "#ffffff",
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
          {/* Roll — the ledger, now on its own /roll page (no longer embedded
              under the home camera), so the nav is its way in. */}
          <Link
            href="/roll"
            onMouseEnter={warmRoll}
            onFocus={warmRoll}
            onTouchStart={warmRoll}
            style={{
              fontSize: 14, fontWeight: 600, color: "#111827",
              textDecoration: "none",
            }}
          >
            Roll
          </Link>
          <Link href="/docs" style={{
            fontSize: 14, fontWeight: 600, color: "#111827",
            textDecoration: "none",
          }}>
            Docs
          </Link>
        </div>
      </div>
    </div>
  );
}

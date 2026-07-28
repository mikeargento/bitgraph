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
        // 44px matches apple.com's global nav and is the iOS minimum touch
        // target, so it is the floor: Roll/Docs sit exactly at it, not above.
        // The wordmark stays 24px rather than shrinking with the bar. Apple can
        // shrink theirs because it is a glyph; here the wordmark IS the logo,
        // and it is the only brand element in the chrome.
        height: 44, display: "flex", alignItems: "center", justifyContent: "space-between",
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
        {/* Gap lives in CSS, not inline, so it can tighten on narrow phones.
            A 12-character label ("Applications", before this settled on "Uses")
            left only 7px between the wordmark and the first link at 320px. */}
        <div className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {/* Uses → Roll → Docs reads left to right from "what is this for" to
              "show me the ledger" to "show me the spec", so the nav gets
              progressively more technical.

              "Uses" over "Applications", which was 80px wide at 14px against
              24px for Roll and 33px for Docs and left the 320px bar at 266px of
              the 288 available. It fit, but nothing was left, and the nav is
              where this site's sparseness reads most. The page heading and the
              route match the label rather than diverging from it. Not "Usage",
              which on a technical site reads as consumption or quota. */}
          <Link href="/uses" style={{
            fontSize: 14, fontWeight: 600, color: "#111827",
            textDecoration: "none",
          }}>
            Uses
          </Link>
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

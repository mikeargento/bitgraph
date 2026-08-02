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
    // The nav shares the page background on purpose. A white bar was tried on
    // 2026-07-27 and reverted: it gave the page a defined top edge, but it also
    // turned the site's one continuous surface into chrome plus content, which
    // is the thing that makes this read as a document rather than an app. White
    // is the cards' value too, so on the Roll and on proof pages the bar and the
    // content were the same colour anyway. If it is ever revisited, #fafafa is
    // the middle option: distinct from the page without borrowing the cards'
    // white. Anything that makes the bar a surface also needs the overscroll
    // block that used to live in globals.css, or pulling down shows the canvas.
    <div id="site-nav" style={{
      borderBottom: "none",
      background: "#f5f5f5",
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
          {/* Why → Roll → Docs reads left to right from "why does this exist"
              to "show me the ledger" to "show me the spec", so the nav gets
              progressively more technical.

              "Why" replaced "Uses" (2026-08-02) once the page came to open with
              the commercial thesis ("Trust is expensive. Proof isn't."): the
              label promised a list of applications and the page delivered an
              argument, and "Uses" carried the SaaS-taxonomy register this site
              strips everywhere else. It is also the narrowest label in the bar,
              which matters at 320px — that width is what killed "Applications"
              (80px at 14px, against 24px for Roll and 33px for Docs, leaving
              the bar at 266px of the 288 available; it fit, but nothing was
              left, and the nav is where this site's sparseness reads most).
              Not "Usage", which on a technical site reads as consumption or
              quota. The route matches the label; /uses 308s to /why. */}
          <Link href="/why" style={{
            fontSize: 14, fontWeight: 600, color: "#111827",
            textDecoration: "none",
          }}>
            Why
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

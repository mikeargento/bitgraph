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
          {/* Subjects → Roll → Docs reads left to right from "what do you point
              this at" to "show me the ledger" to "show me the spec", so the nav
              gets progressively more technical.

              Two renames on 2026-08-02. "Uses" carried the SaaS-taxonomy
              register ("Solutions", "Use cases") this site strips everywhere
              else, and once the page came to open with the commercial thesis
              ("Trust is expensive. Proof isn't.") the label promised a list of
              applications while the page delivered an argument. "Why" fixed the
              register but was vague and, as an interrogative among two nouns,
              broke the series; it also hid the page's second half, the domain
              sections a buyer actually navigates for. "Subjects" is the
              camera's own word for what you point it at, it is a noun like Roll
              and Docs, and the page is literally organized by subject.
              Not "Usage", which on a technical site reads as consumption or
              quota. Not "Recordings"/"Records", which collide with the proof
              page's own Recordings card.
              Width is the standing constraint here: "Applications" (80px at
              14px, against 24px for Roll and 33px for Docs) left the 320px bar
              at 266px of the 288 available, which is what killed it. Re-measure
              at 320px before lengthening this label again.
              The route matches the label; /uses and /why both redirect. */}
          <Link href="/subjects" style={{
            fontSize: 14, fontWeight: 600, color: "#111827",
            textDecoration: "none",
          }}>
            Subjects
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

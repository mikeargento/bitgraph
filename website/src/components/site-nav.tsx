"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { warm, ROLL_FEED_KEY } from "@/lib/warm";
import { DOCS_SECTIONS, DOCS_REPO } from "@/lib/docs-sections";

// Warm the Roll feed the moment the user signals intent to open it, so the page
// paints filled-in instead of spinning. Fires on hover / focus / touch — only
// when there's real intent, never on every page load — and is a no-op once a
// fresh copy is in flight or cached. Next already prefetches the route CODE on
// hover; this brings the DATA, the actual latency.
const warmRoll = () => warm(ROLL_FEED_KEY);

export function SiteNav() {
  const pathname = usePathname();
  const [docsOpen, setDocsOpen] = useState(false);
  const docsRef = useRef<HTMLDivElement>(null);

  // Close on a click outside and on Escape. The menu hangs off a sticky bar, so
  // it can otherwise sit open over content the reader has scrolled to.
  useEffect(() => {
    if (!docsOpen) return;
    const away = (e: MouseEvent) => {
      if (docsRef.current && !docsRef.current.contains(e.target as Node)) setDocsOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDocsOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [docsOpen]);

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
          {/* Docs opens the section list rather than navigating.
              It used to be a plain link to /docs, and every docs page then
              carried a full-width sticky bar of its own holding this menu. That
              bar was a button the width of the reading column whose label
              repeated the h1 eight pixels beneath it, on a site whose rule is
              no buttons. The list belongs in the nav, which is sticky already,
              so a reader deep in the whitepaper can still jump sections.

              Click, not hover: hover menus have no touch equivalent, and this
              has to work on a phone. Visually it stays a nav link, with only a
              chevron to say it opens something. */}
          <div ref={docsRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <button
              onClick={() => setDocsOpen(o => !o)}
              aria-expanded={docsOpen}
              aria-haspopup="menu"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: 0, margin: 0, border: "none", background: "none",
                fontSize: 14, fontWeight: 600, color: "#111827",
                fontFamily: "inherit", letterSpacing: "inherit", cursor: "pointer",
              }}
            >
              Docs
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: docsOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {docsOpen && (
              // Right-aligned and width-capped so it cannot push past the
              // viewport on a phone, where Docs is the last item in the bar.
              <div role="menu" style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0,
                minWidth: 240, maxWidth: "min(320px, calc(100vw - 24px))",
                padding: 8, background: "#fff", border: "1px solid #d0d5dd",
                borderRadius: 0, boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}>
                {DOCS_SECTIONS.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    role="menuitem"
                    onClick={() => setDocsOpen(false)}
                    style={{
                      display: "block", padding: "8px 12px", fontSize: 14,
                      fontWeight: pathname === s.href ? 600 : 400,
                      color: pathname === s.href ? "#111827" : "#4b5563",
                      textDecoration: "none",
                      background: pathname === s.href ? "#f3f4f6" : "transparent",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.label}
                  </Link>
                ))}
                {/* The one external link, always last. */}
                <a
                  href={DOCS_REPO}
                  target="_blank"
                  rel="noopener"
                  role="menuitem"
                  onClick={() => setDocsOpen(false)}
                  style={{
                    display: "block", padding: "8px 12px", fontSize: 14,
                    fontWeight: 400, color: "#4b5563", textDecoration: "none",
                  }}
                >
                  GitHub
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

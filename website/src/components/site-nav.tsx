"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { warm, ROLL_FEED_KEY } from "@/lib/warm";
import { DOCS_GROUPS, DOCS_TAIL, DOCS_REPO, type DocsSection } from "@/lib/docs-sections";

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
  // The panel spans the bar rather than hanging off the button, so it is no
  // longer inside docsRef and needs its own: a mousedown on the panel's own
  // padding would otherwise read as a click outside and shut it.
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on a click outside and on Escape. The menu hangs off a sticky bar, so
  // it can otherwise sit open over content the reader has scrolled to.
  useEffect(() => {
    if (!docsOpen) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (docsRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setDocsOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDocsOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [docsOpen]);

  // One row, whether it comes from a group or from the loose tail below them.
  const renderItem = (s: DocsSection) => (
    <Link
      key={s.href}
      href={s.href}
      role="menuitem"
      className="docs-menu-item"
      aria-current={pathname === s.href ? "page" : undefined}
      onClick={() => setDocsOpen(false)}
      style={{
        display: "block", padding: "7px 10px", fontSize: 14,
        fontWeight: pathname === s.href ? 600 : 400,
        textDecoration: "none",
      }}
    >
      {s.label}
    </Link>
  );

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
      // The 44px bar centres a 36px wordmark, which left it 4px off the top of
      // the window: the logo looked pinned to the edge rather than placed on
      // the page. This is padding on the STICKY element, not a margin on the
      // page, so the air survives scrolling. It is invisible when stuck
      // because the bar has no border and the same background as the page, so
      // it simply seats the wordmark lower instead of opening a gap.
      paddingTop: 14,
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
          {/* Roll → Docs: the ledger, then the spec. The page of what you
              point the camera at lived here for months under four names
              (Uses → Why → Subjects → Applications → "Use cases", each a
              deliberate call, the history is in git) and moved INTO the Docs
              menu on 2026-08-05 as its second entry — Mike: "'Use cases'
              should be moved to inside the docs." The 320px width battle
              this slot kept fighting went with it.
              Its ROUTE stays /subjects on purpose: /applications shipped as
              a PERMANENT 308 to /uses on 2026-07-27, and /uses 308s onward,
              so reviving either path as a real page risks a cached-redirect
              loop for anyone holding the old redirect. */}
          {/* Roll — the ledger, now on its own /roll page (no longer embedded
              under the home camera), so the nav is its way in. */}
          <Link
            href="/roll"
            aria-current={pathname === "/roll" ? "page" : undefined}
            onMouseEnter={warmRoll}
            onFocus={warmRoll}
            onTouchStart={warmRoll}
            style={{ fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            Roll
          </Link>
          {/* Folder — the Mac software's page. The /folder BROWSER (your
              recordings, remembered in the browser) was removed 2026-08-07
              ("causing more bugs than its worth"); the link survives it and
              points at the story instead. Browsing = drop Recordings on the
              home camera. */}
          <Link
            href="/docs/folder"
            aria-current={pathname === "/docs/folder" ? "page" : undefined}
            style={{ fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            Folder
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
          <div ref={docsRef} style={{ display: "flex", alignItems: "center" }}>
            <button
              onClick={() => setDocsOpen(o => !o)}
              aria-expanded={docsOpen}
              aria-haspopup="menu"
              // Current for any docs route, including one not in the list, and
              // while the menu is open: an open menu is a place you are too.
              aria-current={(pathname?.startsWith("/docs") || docsOpen) ? "page" : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: 0, margin: 0, border: "none", background: "none",
                fontSize: 14, fontWeight: 700,
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
          </div>
        </div>
      </div>
      {/* ── The section panel. It spans the bar rather than hanging off the
          Docs link, which is what lets the fifteen places sit in columns
          instead of one column fifteen long. As a narrow dropdown the grouped
          list had become a scroll (Mike, 2026-08-09: "a long scroll now"), and
          a menu you have to scroll to see is worse than the ungrouped list it
          replaced: you can no longer take in the shape of the docs at a
          glance, which is the whole point of grouping them.

          The white is full-bleed, edge to edge, but the COLUMNS are not: they
          sit in the same 90%/800px measure as the wordmark above them and the
          page below, so the panel reads as the page opening rather than as an
          app's mega menu landing on top of it. Square corners, one hairline
          under it, no side borders, per the site.

          Absolute against #site-nav, which is sticky and therefore already a
          containing block. top:100% puts it exactly under the bar with no gap
          to fall through on the way to it. ── */}
      {docsOpen && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Docs sections"
          style={{
            position: "absolute", top: "100%", left: 0, right: 0,
            background: "#fff", borderTop: "1px solid #e5e7eb",
            borderBottom: "1px solid #d0d5dd", borderRadius: 0,
            boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            // A backstop, not the layout: the columns fit a phone in portrait
            // with room to spare. It is landscape, where the viewport is 375
            // tall, that would otherwise clip.
            maxHeight: "calc(100dvh - 58px)", overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "22px 0 20px" }}>
            {/* Multi-column rather than a grid: the groups are 6, 3 and 5 rows,
                and column balancing lays them out on its own at whatever count
                fits, three across on a laptop and two on a phone. break-inside
                keeps a group whole, so a heading can never end up at the foot
                of one column with its items at the head of the next. The -10px
                pulls the rows' own padding back so their text lines up with the
                wordmark above. */}
            <div className="docs-panel-cols" style={{ margin: "0 -10px" }}>
              {DOCS_GROUPS.map((g) => (
                <div key={g.label} role="group" aria-label={g.label} className="docs-panel-group">
                  {/* Small, tracked-out, uppercase, 800, near-black. These
                      shipped grey twice (600/#9ca3af, then 700/#6b7280) and
                      read as faded rows both times: a label in a value between
                      the rows' grey and the panel's white cannot be told from a
                      row at a glance, whatever its weight. The value has to
                      LEAD the items it heads. Size is what keeps it quiet, 11px
                      against their 14px. aria-hidden because role="group"
                      already carries the name to assistive tech. */}
                  <div
                    aria-hidden="true"
                    style={{
                      padding: "0 10px 8px",
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.12em",
                      textTransform: "uppercase", color: "#111827",
                    }}
                  >
                    {g.label}
                  </div>
                  {g.items.map(renderItem)}
                </div>
              ))}
            </div>
            {/* FAQ and the repo, under the columns, held apart by air alone.
                A hairline ran here first and was cut (Mike, 2026-08-09, asking
                whether whitespace could do it): the row already sits under all
                three columns and outside every heading, so the rule was saying
                a second time what the position had said, and it was the only
                horizontal line in the panel.

                Not a fourth COLUMN either, which was the other half of the same
                question. Columns read as peer categories, and a fourth would
                give two loose links the weight of Understand's six. It would
                also need a heading to sit there, and any heading invented for
                it would be wrong about one of them: FAQ is the last stop in the
                reading sequence, GitHub is a destination outside it. */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              margin: "34px -10px 0",
            }}>
              {DOCS_TAIL.map(renderItem)}
              <a
                href={DOCS_REPO}
                target="_blank"
                rel="noopener"
                role="menuitem"
                className="docs-menu-item"
                onClick={() => setDocsOpen(false)}
                style={{
                  display: "block", padding: "7px 10px", fontSize: 14,
                  fontWeight: 400, textDecoration: "none",
                }}
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

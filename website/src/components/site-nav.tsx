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

  // One column heading. Shared, because Reference is built by hand rather than
  // from DOCS_GROUPS, and the first thing that happened when these were two
  // copies was that an underline went on three of the four.
  //
  // No rule of any kind on it now, and none anywhere inside the panel. Three
  // placements were tried on 2026-08-09 and all three are gone: vertical
  // between the columns (a rule has to pick a height, and a grid with ragged
  // bottoms offers none), a cap above each heading (floats, unattached to
  // anything, and breaks into two segments at two columns), and this underline
  // (which did work, and was still one more element than the headings needed).
  // Four near-black bold labels against 14px grey rows separate the columns on
  // their own. The panel is type and the card's edge.
  //
  // Small, tracked-out, uppercase, 800, near-black. These shipped grey twice
  // (600/#9ca3af, then 700/#6b7280) and read as faded rows both times: a label
  // in a value between the rows' grey and the panel's white cannot be told from
  // a row at a glance, whatever its weight. The value has to LEAD the items it
  // heads. Size is what keeps it quiet, 11px against their 14px.
  //
  // aria-hidden because the enclosing role="group" already carries the name to
  // assistive tech, and it would otherwise be announced twice.
  const renderHeading = (label: string) => (
    <div
      aria-hidden="true"
      style={{
        padding: "0 10px 8px",
        fontSize: 11, fontWeight: 800, letterSpacing: "0.12em",
        textTransform: "uppercase", color: "#111827",
      }}
    >
      {label}
    </div>
  );

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
    // white. It IS a surface now (white, hairline), and the overscroll canvas
    // is handled by the html background in globals.css.
    <div id="site-nav" style={{
      // A surface, since the bar spans the window (2026-08-16): white with a
      // hairline under it, the way an app's bar sits over its page. The
      // canvas above the page origin is painted white too (html background in
      // globals.css) so a rubber-band scroll shows the bar's colour, not the
      // page's; see the note that follows.
      borderBottom: "1px solid #e5e7eb",
      background: "#ffffff",
      position: "sticky", top: 0, zIndex: 50,
      // One 56px row, wordmark and links centred in it. The 14px top padding
      // that used to seat the wordmark lower belonged to an invisible bar; on
      // a white surface it read as the row sitting low. (Mike, 2026-08-16.)
    }}>
      <div style={{
        // The bar spans the window: wordmark hard left, links hard right, the
        // way Gmail's bar spans its pane. Site-wide since 2026-08-16 (Mike),
        // so the chrome is one thing on every page: the reading pages keep
        // their 800px column under it, the cassette pane fills the window,
        // and the wordmark never jumps between the two. The 20px edge is the
        // pane's rail edge, so the wordmark and the rail share a left line.
        // Before this the bar sat over the 800px column (width 90%, max 800,
        // centred); that is the one-line revert if it ever reads wrong.
        width: "100%", maxWidth: "none", margin: 0, padding: "0 20px", boxSizing: "border-box" as const,
        // 56px: apple.com's 44 was the floor for the touch target; a surface
        // bar wants a little more air around a 24px wordmark. Everything in
        // the row is centred on its middle.
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
          {/* Actor — /actor, the camera that puts your key on a recording.
              It shipped 2026-08-18 deliberately unlinked (Mike: "hidden with no
              link which is fine") and is linked here from 2026-08-19, after the
              feature settled on its name.

              ⚠️ It sits AFTER Folder and before Docs on purpose. Roll is what
              to look at, Folder and Actor are the two tools, Docs is the
              reference. It must never come before Roll: an unregistered visitor
              clicking Actor first meets a passkey prompt as their introduction
              to the site, and home's rule is that a first-time visitor drops a
              file and gets a proof with no dialog and no decision.

              The route moved /declare -> /actor on 2026-08-19 so the URL says
              what the page is. /declare 307s here; TEMPORARY on purpose, in
              line with every other rename on this site (see next.config.ts),
              because a 308 bakes into browser caches indefinitely and this
              name is one day old. */}
          <Link
            href="/actor"
            aria-current={pathname === "/actor" ? "page" : undefined}
            style={{ fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            Actor
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

          It is the width of the CONTENT, not of the window. The white went
          full-bleed first and was pulled back the same day: edge to edge it is
          a mega menu landing on the page, which is the app-shaped thing this
          site keeps refusing to be. At the 90%/800px measure it is a card in
          the column, its edges under the wordmark and over the page's own,
          which is how every other surface here behaves. Square corners, 1px
          #d0d5dd, per the cards.

          Absolute against #site-nav, which is sticky and therefore already a
          containing block; centred on it rather than hung off the Docs link,
          so the edges land on the measure and not near it. ── */}
      {docsOpen && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Docs sections"
          style={{
            // A strip under the bar, the bar's own width, flush with its
            // hairline: the sections sit in the reading column inside it. The
            // bar spans the window, so a floating box hung from Docs related
            // to nothing; the strip belongs to the bar (Mike, 2026-08-16).
            position: "absolute", top: "100%", left: 0, right: 0,
            background: "#fff", borderBottom: "1px solid #d0d5dd", borderRadius: 0,
            boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            // A backstop, not the layout: the columns fit a phone in portrait
            // with room to spare. It is landscape, where the viewport is 375
            // tall, that would otherwise clip.
            maxHeight: "calc(100dvh - 74px)", overflowY: "auto",
            overscrollBehavior: "contain",
            padding: "22px 0 20px",
          }}
        >
          <div style={{ width: "90%", maxWidth: 800, margin: "0 auto" }}>
            {/* Four cells, tops aligned, bottoms wherever each group ends. See
                globals.css for why this is a grid and not balanced columns. */}
            <div className="docs-panel-cols">
              {DOCS_GROUPS.map((g) => (
                <div key={g.label} role="group" aria-label={g.label} className="docs-panel-group">
                  {renderHeading(g.label)}
                  {g.items.map(renderItem)}
                </div>
              ))}
              {/* The fourth cell: FAQ and the repo, under REFERENCE.

                  They ran as a row beneath the columns first, under a rule and
                  then under air, and neither held: without the rule they read
                  as "lost floating there" (Mike), and with it the rule was
                  furniture doing what the grid does for free. Then the cell
                  carried a blank where the other three carry a heading, which
                  aligned the rows but left a hole for the reader to wonder at.

                  "More" was the alternative and is the word you reach for when
                  you have not decided what a group is. Reference is true of
                  both without claiming they are a section of the docs: the FAQ
                  is what you look an answer up in, and the repo is the
                  reference implementation the proof format is derived from.
                  It says nothing about the reading sequence, which is the one
                  thing a label here could get wrong, since FAQ closes that
                  sequence and the repo sits outside it. */}
              <div role="group" aria-label="Reference" className="docs-panel-group">
                {renderHeading("Reference")}
                {DOCS_TAIL.map(renderItem)}
                {/* The one row of sixteen that leaves the site, and the only one
                    that opens a new tab. It behaved differently from its
                    neighbours and looked identical to them, so it now carries a
                    ↗. Not the → the action links use, which means go forward
                    within the site; this one means the destination is
                    elsewhere. It stays quiet: 10px, the row's own colour, no
                    weight of its own.

                    The glyph is decoration to a screen reader, which gets the
                    same fact as words instead. */}
                <a
                  href={DOCS_REPO}
                  target="_blank"
                  rel="noopener"
                  role="menuitem"
                  className="docs-menu-item"
                  onClick={() => setDocsOpen(false)}
                  style={{
                    display: "flex", alignItems: "baseline", gap: 5,
                    padding: "7px 10px", fontSize: 14,
                    fontWeight: 400, textDecoration: "none",
                  }}
                >
                  GitHub
                  <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>&#8599;</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

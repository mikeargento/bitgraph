/* ── Proof page shell + loading skeleton ──
   Shared by the page itself (data-fetch wait) and the route's loading.tsx
   (App Router transition wait), so a navigation paints THIS immediately and
   the page's own skeleton phase continues it seamlessly — one visual wait,
   no dead click while the route's payload streams in. No hooks: safe as a
   server component in loading.tsx and as plain JSX in the client page. */

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      {children}
    </div>
  );
}

/* The proof page's loaded shape is the always-open "BitGraph Record" card
   followed by a stack of collapsed card headers, so the wait renders that
   exact layout as shimmering placeholders. The cards sit where the real ones
   will, so data arriving swaps content in with minimal jump; the shimmer
   reads as alive where a static "Loading…" line read as stuck. */
export function ProofSkeleton() {
  // The skeleton cannot know what kind of proof is loading (a file, a photo, an
  // Ethereum anchor) until the proof arrives, so it draws only what every one of
  // them has, in the same places: the card head, then the identity row (a file's
  // name, or an anchor's block, with Open on the right). A preview or a photo
  // then arrives below that row, which reads as content arriving, not as a jump.
  // Nothing sits above the card on any proof (an anchor's way back rides on the
  // head's first line since 2026-09-27), so the card lands where this one is.
  // Seven collapsed rows: an anchor has seven; a file proof has more, below the
  // fold. Varied title widths so the rows look like real labels.
  const titleWidths = [92, 150, 104, 132, 96, 140, 88];
  const bar: React.CSSProperties = { borderRadius: "var(--radius-card)" };
  return (
    <Shell>
      <style>{`
        @keyframes bgSkel { 0% { background-position: 100% 0 } 100% { background-position: 0 0 } }
        .bg-skel { background: linear-gradient(90deg, var(--line-2) 25%, var(--line) 37%, var(--line-2) 63%); background-size: 400% 100%; animation: bgSkel 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .bg-skel { animation: none; } }
      `}</style>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", padding: "56px 0 96px" }}>
        {/* No page title above the card (2026-09-26): the card head names the record,
            so the skeleton opens straight on the card. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }} aria-hidden>
          {/* Primary card: the head, then the identity row, inside the 4px top and
              bottom padding the loaded card's .proof-fields body carries. */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)" }}>
            <div style={{ padding: "4px 0" }}>
            {/* The card head: "BitGraph #n", the date and time, the epoch. Each bar sits in
                a row the height of the real line (14px at 1.6, 22.4px, measured), so the
                loaded head lands without a jump. */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ height: 22.4, display: "flex", alignItems: "center" }}><div className="bg-skel" style={{ ...bar, width: 124, height: 15 }} /></div>
              <div style={{ height: 22.4, display: "flex", alignItems: "center" }}><div className="bg-skel" style={{ ...bar, width: "min(262px, 88%)", height: 13 }} /></div>
              <div style={{ height: 22.4, display: "flex", alignItems: "center" }}><div className="bg-skel" style={{ ...bar, width: "min(380px, 96%)", height: 12 }} /></div>
            </div>
            {/* The identity row, in the loaded row's geometry: 12px 16px around a
                32px Open button, the name on the left. (A hash block and an Export
                row sat here until 2026-09-27; neither exists on the page any more.) */}
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div className="bg-skel" style={{ ...bar, width: "min(236px, 58%)", height: 14 }} />
              <div className="bg-skel" style={{ ...bar, width: 60, height: 32, flexShrink: 0 }} />
            </div>
            </div>
          </div>
          {titleWidths.map((w, i) => (
            <div key={i} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card)" }}>
              {/* Same header geometry as CollapsibleCard: 14px 16px, title left,
                  collapsed chevron right (matching the real card's toggle). */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px" }}>
                <div className="bg-skel" style={{ ...bar, width: w, height: 15 }} />
                <span aria-hidden style={{ display: "inline-flex", flexShrink: 0, color: "var(--faint)" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                </span>
              </div>
            </div>
          ))}
        </div>
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} role="status">Loading BitGraph…</span>
      </div>
    </Shell>
  );
}

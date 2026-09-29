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

/* The proof page's loaded shape is a stack of collapsed card headers, the
   record card first (it folds too since 2026-09-28, labelled "BitGraph #n"),
   so the wait renders that exact layout as shimmering placeholders. The cards
   sit where the real ones will, so data arriving swaps content in with no
   jump; the shimmer reads as alive where a static "Loading…" line read as
   stuck. */
export function ProofSkeleton() {
  // The skeleton cannot know what kind of proof is loading (a file, a photo, an
  // Ethereum anchor) until the proof arrives, and it no longer needs to: every
  // kind opens on the same closed rows, the record card first. Eight rows: an
  // anchor has eight; a file proof has more, below the fold. Varied title widths
  // so the rows look like real labels, the first sized for "BitGraph #n,nnn ·
  // epoch xxxxxxxx".
  const titleWidths = [236, 92, 150, 104, 132, 96, 140, 88];
  const bar: React.CSSProperties = { borderRadius: "var(--radius-card)" };
  return (
    <Shell>
      <style>{`
        @keyframes bgSkel { 0% { background-position: 100% 0 } 100% { background-position: 0 0 } }
        .bg-skel { background: linear-gradient(90deg, var(--line-2) 25%, var(--line) 37%, var(--line-2) 63%); background-size: 400% 100%; animation: bgSkel 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .bg-skel { animation: none; } }
      `}</style>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", padding: "96px 0 96px" }}>
        {/* No page title above the cards (2026-09-26): the record card's label names
            the record, so the skeleton opens straight on the rows. */}
        <div className="proof-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }} aria-hidden>
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

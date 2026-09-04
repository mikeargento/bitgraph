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
  // The primary card's body varies by file type (a photo is tall, any other
  // file is just when + hash), and we can't know which before the fetch, so the
  // skeleton renders only the guaranteed-present parts — a "when" line and a
  // hash line, no image box. A photo simply pushes the hash down as it loads
  // (reads as content arriving), and a plain file matches with no jump.
  // Varied title widths so the collapsed rows below look like real labels.
  const titleWidths = [92, 150, 104, 132, 96, 140, 88];
  const bar: React.CSSProperties = { borderRadius: 3 };
  return (
    <Shell>
      <style>{`
        @keyframes bgSkel { 0% { background-position: 100% 0 } 100% { background-position: 0 0 } }
        .bg-skel { background: linear-gradient(90deg, #edeff1 25%, #e0e3e7 37%, #edeff1 63%); background-size: 400% 100%; animation: bgSkel 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .bg-skel { animation: none; } }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
        {/* "BitGraph Record" now sits ABOVE the card as a page heading, so the
            skeleton leads with it rather than with a header band. */}
        <div className="bg-skel" style={{ ...bar, width: 196, height: 21, marginBottom: 10 }} aria-hidden />
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }} aria-hidden>
          {/* Primary card: no header band any more — it opens straight on the
              "when" block, then the hash, then the Export action link. */}
          <div style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0 }}>
            {/* "when": a date line over a time line. */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9", display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="bg-skel" style={{ ...bar, width: 132, height: 15 }} />
              <div className="bg-skel" style={{ ...bar, width: 212, height: 13 }} />
            </div>
            {/* File Hash: a label over its value. */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9", display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="bg-skel" style={{ ...bar, width: 68, height: 14 }} />
              <div className="bg-skel" style={{ ...bar, width: "64%", height: 13 }} />
            </div>
            {/* Export — an action link row, not a button. */}
            <div style={{ padding: "14px 16px" }}>
              <div className="bg-skel" style={{ ...bar, width: 172, height: 14 }} />
            </div>
          </div>
          {titleWidths.map((w, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0 }}>
              {/* Same header geometry as CollapsibleCard: 14px 16px, title left,
                  collapsed chevron right (matching the real card's toggle). */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px" }}>
                <div className="bg-skel" style={{ ...bar, width: w, height: 15 }} />
                <span aria-hidden style={{ display: "inline-flex", flexShrink: 0, color: "#c7ccd1" }}>
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

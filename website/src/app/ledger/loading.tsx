/* ── Painted by the App Router the instant a navigation to /day starts,
   while the server component awaits its SSR seed (up to the 1200ms budget
   in page.tsx, plus network). Without this file that wait is a dead click:
   the previous page just sits there. With it, the ledger's own frame appears
   immediately and the Explorer's in-page row skeletons continue the same
   visual wait, so transition and data read as one moment.

   The geometry below mirrors the loaded page and the Explorer's row chrome
   (xp-row: 14px 16px padding, 12px gap, #d0d5dd border, 10px row gap) so
   content lands in place with no jump. The title is real text because it is
   the one thing on the page that never varies; everything whose content
   depends on data (subtitle, nav line, search, rows) shimmers. Server
   component by design: no hooks, no imports from the client Explorer. ── */

export default function Loading() {
  const bar: React.CSSProperties = { borderRadius: 3 };
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        @keyframes rlSkel { 0% { background-position: 100% 0 } 100% { background-position: 0 0 } }
        .rl-skel { background: linear-gradient(90deg, #edeff1 25%, #e0e3e7 37%, #edeff1 63%); background-size: 400% 100%; animation: rlSkel 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .rl-skel { animation: none; } }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }} aria-hidden>
        {/* Heading: the real title (it never varies), a shimmer where the
            live-vs-day subtitle will land. */}
        <div style={{ marginBottom: 12 }}>
          <div className="bg-page-title">BitGraph Ledger</div>
          <div className="rl-skel" style={{ ...bar, width: 208, height: 14, marginTop: 6 }} />
        </div>

        {/* The nav line: day stepper left, anchors toggle + All days right. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
          <div className="rl-skel" style={{ ...bar, width: 72, height: 13 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="rl-skel" style={{ ...bar, width: 96, height: 13 }} />
            <div className="rl-skel" style={{ ...bar, width: 64, height: 13 }} />
          </div>
        </div>

        {/* Search: the form's real chrome (white, hairline border, square),
            shimmer where the placeholder and the action sit. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0, padding: "10px 14px" }}>
          <div className="rl-skel" style={{ ...bar, width: 110, height: 14 }} />
          <div className="rl-skel" style={{ ...bar, width: 62, height: 14 }} />
        </div>

        {/* Ledger rows: same chrome as the Explorer's own skeleton (# left,
            tag, date right, Open chevron), so its rows continue this wait
            seamlessly and real entries land with no jump. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #d0d5dd" }}>
              <span className="rl-skel" style={{ ...bar, width: 60, height: 14, flexShrink: 0 }} />
              <span className="rl-skel" style={{ ...bar, width: 34, height: 12, flexShrink: 0 }} />
              <span style={{ flex: 1 }} />
              <span className="rl-skel" style={{ ...bar, width: 84, height: 12, flexShrink: 0 }} />
              <span style={{ display: "inline-flex", flexShrink: 0, color: "#c7ccd1" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
              </span>
            </div>
          ))}
        </div>
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} role="status">Opening the ledger…</span>
      </div>
    </div>
  );
}

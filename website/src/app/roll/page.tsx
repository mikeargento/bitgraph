"use client";

import { Explorer } from "@/components/explorer";

/* ── BitGraph Roll — the ledger stream, on its own page. Every recording in
   causal order, newest first, with search. The camera's roll: the home page
   takes BitGraphs, this is where they live. ── */

export default function RollPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
        <Explorer title={
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827" }}>
              BitGraph Roll
            </div>
            <div style={{ fontSize: 13, fontWeight: 400, color: "#4b5563", marginTop: 2 }}>
              Every recording, newest first.
            </div>
          </div>
        } />
      </div>
    </div>
  );
}

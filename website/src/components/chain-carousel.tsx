"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ChainProof {
  commit: { counter?: string; slotCounter?: string; epochId?: string };
  artifact: { digestB64: string; hashAlg: string };
  attribution?: { name?: string; title?: string };
  environment?: { enforcement?: string };
  signer: { publicKeyB64: string };
}

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getProofType(p: ChainProof): { label: string; icon: string; isAnchor: boolean } {
  const name = p.attribution?.name || "";
  if (name.startsWith("Ethereum")) return { label: "Anchor", icon: "\u26D3\uFE0F", isAnchor: true };
  // Check for common file types in attribution or just default to "Proof"
  const lower = name.toLowerCase();
  if (lower.includes("photo") || lower.includes("image")) return { label: "Photo", icon: "\uD83D\uDCF7", isAnchor: false };
  if (lower.includes("video")) return { label: "Video", icon: "\uD83C\uDFA5", isAnchor: false };
  if (lower.includes("audio")) return { label: "Audio", icon: "\uD83C\uDFA7", isAnchor: false };
  if (lower.includes("document") || lower.includes("doc")) return { label: "Doc", icon: "\uD83D\uDCC4", isAnchor: false };
  return { label: "Proof", icon: "\uD83D\uDD10", isAnchor: false };
}

export default function ChainCarousel({ epochId, currentCounter }: { epochId: string; currentCounter: number }) {
  const [proofs, setProofs] = useState<ChainProof[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(
          `/api/proofs/chain?epoch=${encodeURIComponent(epochId)}&counter=${currentCounter}&before=5&after=5`
        );
        if (!resp.ok) { setLoading(false); return; }
        const data = await resp.json();
        setProofs(data.proofs || []);
      } catch { /* silent */ }
      setLoading(false);
    })();
  }, [epochId, currentCounter]);

  // Scroll to center the current proof card on mount
  useEffect(() => {
    if (!scrollRef.current || proofs.length === 0) return;
    const container = scrollRef.current;
    const currentIdx = proofs.findIndex(
      (p) => parseInt(p.commit.counter || "0", 10) === currentCounter
    );
    if (currentIdx < 0) return;
    const cards = container.children;
    if (!cards[currentIdx]) return;
    const card = cards[currentIdx] as HTMLElement;
    const scrollLeft = card.offsetLeft - container.offsetWidth / 2 + card.offsetWidth / 2;
    container.scrollTo({ left: scrollLeft, behavior: "instant" });
  }, [proofs, currentCounter]);

  const scroll = useCallback((dir: number) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir * 160, behavior: "smooth" });
  }, []);

  if (loading) {
    return (
      <div style={{ marginBottom: 24, padding: "20px 0", textAlign: "center", color: "var(--c-text-tertiary)", fontSize: 13 }}>
        Loading chain...
      </div>
    );
  }

  if (proofs.length <= 1) return null; // No carousel needed for single proof

  return (
    <div style={{ marginBottom: 28, position: "relative" }}>
      {/* Left arrow */}
      <button
        onClick={() => scroll(-1)}
        aria-label="Scroll left"
        style={{
          position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)", zIndex: 2,
          width: 32, height: 32, borderRadius: "50%", border: "1px solid #d0d5dd",
          background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color: "#4b5563", boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        &#8249;
      </button>

      {/* Scrollable track */}
      <div
        ref={scrollRef}
        style={{
          display: "flex", gap: 10, overflowX: "auto", scrollSnapType: "x mandatory",
          padding: "8px 24px", scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {proofs.map((p) => {
          const counter = parseInt(p.commit.counter || "0", 10);
          const isCurrent = counter === currentCounter;
          const { label, icon, isAnchor } = getProofType(p);
          const digest = toUrlSafe(p.artifact.digestB64);

          return (
            <div
              key={p.commit.counter}
              onClick={() => {
                if (!isCurrent) router.push(`/proof/${encodeURIComponent(digest)}`);
              }}
              style={{
                flex: "0 0 auto", width: 120, minHeight: 120,
                scrollSnapAlign: "center",
                background: isAnchor ? "#f0fdf4" : "#fff",
                border: isCurrent ? "2px solid #0065A4" : isAnchor ? "1px solid #bbf7d0" : "1px solid #d0d5dd",
                borderRadius: 0,
                cursor: isCurrent ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "14px 8px", gap: 4,
                boxShadow: isCurrent ? "0 0 0 3px rgba(0,101,164,0.15)" : "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
                opacity: isCurrent ? 1 : 0.85,
              }}
              onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget.style.opacity = "1"); }}
              onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget.style.opacity = "0.85"); }}
            >
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span style={{
                fontSize: 18, fontWeight: 800, color: "#111827",
                lineHeight: 1.1,
              }}>
                #{p.commit.counter}
              </span>
              <span style={{
                fontSize: 10, color: isAnchor ? "#16a34a" : "#4b5563",
                textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
              }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scroll(1)}
        aria-label="Scroll right"
        style={{
          position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)", zIndex: 2,
          width: 32, height: 32, borderRadius: "50%", border: "1px solid #d0d5dd",
          background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color: "#4b5563", boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        &#8250;
      </button>

      {/* Hide scrollbar */}
      <style>{`
        div[style*="scrollSnapType"]::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

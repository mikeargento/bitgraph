"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Entry = {
  counter: number;
  type: "proof" | "anchor";
  digest: string;
  hashShort: string;
  blockNumber: number | null;
  etherscanUrl: string | null;
};

const fmt = (n: number) => n.toLocaleString();

export function Explorer() {
  const [entries, setEntries] = useState<Entry[]>([]);
  // Counters that arrived via the live poll (not the initial load), so only
  // those rows get the arrival flash. Grows slowly; the animation runs once.
  const [freshIds, setFreshIds] = useState<Set<number>>(() => new Set());
  const [head, setHead] = useState<number | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const busyRef = useRef(false);
  const topRef = useRef(0);

  // Initial load. A cold request can be slow while the endpoint discovers the
  // epoch head, so retry a few times with a per-attempt timeout rather than
  // hanging forever on one stalled fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 15000);
          const r = await fetch("/api/explorer", { signal: ctrl.signal });
          clearTimeout(to);
          if (!r.ok) throw new Error();
          const j = await r.json();
          if (cancelled) return;
          setEntries(j.entries || []);
          setHead(j.head ?? null);
          setNextBefore(j.nextBefore ?? null);
          setHasMore(!!j.hasMore);
          topRef.current = j.entries?.[0]?.counter ?? 0;
          setLoading(false);
          return;
        } catch {
          if (!cancelled) await new Promise((res) => setTimeout(res, 1500));
        }
      }
      if (!cancelled) { setError(true); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live poll: every ~12s (anchor cadence), pull the head page and prepend new entries.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/explorer");
        if (!r.ok) return;
        const j = await r.json();
        setHead(j.head ?? null);
        const fresh: Entry[] = (j.entries || []).filter((e: Entry) => e.counter > topRef.current);
        if (fresh.length) {
          topRef.current = fresh[0].counter;
          setEntries((prev) => [...fresh, ...prev]);
          setFreshIds((prev) => {
            const next = new Set(prev);
            for (const e of fresh) next.add(e.counter);
            return next;
          });
        }
      } catch { /* transient, ignore */ }
    }, 12000);
    return () => clearInterval(id);
  }, []);

  const loadMore = useCallback(async () => {
    if (busyRef.current || nextBefore == null || !hasMore) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/explorer?before=${nextBefore}`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.counter));
        return [...prev, ...(j.entries || []).filter((e: Entry) => !seen.has(e.counter))];
      });
      setNextBefore(j.nextBefore ?? null);
      setHasMore(!!j.hasMore);
    } catch { /* keep what we have */ }
    finally { busyRef.current = false; setLoadingMore(false); }
  }, [nextBefore, hasMore]);

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: "500px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

  return (
    <div>
      <style>{`
        @keyframes xpBlink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes xpIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        @keyframes xpArrive { 0%{opacity:0;transform:translateY(-8px);background:#ecfdf5} 50%{opacity:1;transform:none;background:#ecfdf5} 100%{opacity:1;transform:none;background:transparent} }
        .xp-row { display:flex; align-items:center; gap:12px; padding:14px 16px; border-top:1px solid #eef0f1; text-decoration:none; animation:xpIn .25s ease-out; transition:background .12s; }
        .xp-row:first-child { border-top:none; }
        /* Live arrivals only: a stronger slide plus a brief trust-green flash
           that ends fully transparent, so nothing tinted is left behind. */
        .xp-row-fresh { animation: xpArrive 1.4s ease-out; }
        .xp-open { display:inline-flex; align-items:center; gap:5px; flex-shrink:0; color:#0065A4; font-size:14px; font-weight:600; transition:gap .15s; }
        @media (hover:hover){
          .xp-row:hover { background:#f3f5f7; }
          .xp-row:hover .xp-open { gap:9px; }
        }
      `}</style>

      {/* Header — live indicator, centered above the count */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#10b981", animation: "xpBlink 1.6s ease-in-out infinite" }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#0065A4" }}>Live BitGraphs</span>
        </span>
      </div>

      {/* Head counter — the machine running */}
      <div style={{ textAlign: "center", padding: "2px 0 18px" }}>
        <div style={{ fontSize: "min(34px, 7vw)", fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {head != null ? fmt(head) : "—"}
        </div>
      </div>

      {/* Legend — both are BitGraphs; the dot says what each one is of */}
      <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "4px 18px", marginBottom: 12, fontSize: 12, color: "#6b7280" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#0065A4" }} /> a BitGraphed file
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#94a3b8" }} /> a future anchor
        </span>
      </div>

      {/* Stream — generic ledger rows; type and specifics live on the drill-in */}
      <div style={{ background: "#fff", border: "1px solid #d0d5dd" }}>
        {loading && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Reading the ledger…</div>}
        {error && !loading && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Ledger unavailable right now.</div>}

        {!loading && !error && entries.map((e) => {
          const isAnchor = e.type === "anchor";
          return (
            <a key={e.counter} href={`/proof/${e.digest}`} target="_blank" rel="noopener" className={freshIds.has(e.counter) ? "xp-row xp-row-fresh" : "xp-row"}>
              <span aria-hidden title={isAnchor ? "BitGraph of an Ethereum block" : "BitGraph of a file"} style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 99, background: isAnchor ? "#94a3b8" : "#0065A4" }} />
              <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 400, color: "#374151" }}>
                BitGraph
                <span style={{ marginLeft: 7, fontSize: 14, fontWeight: 700, color: "#0065A4", fontVariantNumeric: "tabular-nums", fontFamily: mono }}>#{fmt(e.counter)}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#9ca3af", fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                {e.hashShort}…
              </span>
              <span className="xp-open">
                Open
                <span aria-hidden style={{ fontSize: 20, lineHeight: 1, fontWeight: 600 }}>›</span>
              </span>
            </a>
          );
        })}

        {!loading && !error && (
          <div ref={sentinel} style={{ padding: 16, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
            {loadingMore ? "Loading…" : hasMore ? " " : "Beginning of epoch"}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Entry = {
  counter: number;
  type: "proof" | "anchor" | "interval";
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
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  const busyRef = useRef(false);
  const topRef = useRef(0);

  // Jump to a BitGraph by number (#614589 / 614,589) or by hash. One round-trip
  // to /api/search, which only returns a link once the proof is retrievable, so
  // it can never bounce to "Proof not found".
  const onSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearchErr("");
    setSearching(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      // ?counter= selects the exact causal position when the same bytes were
      // BitGraphed more than once (a hash search omits it: earliest wins).
      if (j.found && j.digest) window.open(`/proof/${encodeURIComponent(j.digest)}${j.counter ? `?counter=${encodeURIComponent(j.counter)}` : ""}`, "_blank", "noopener");
      else setSearchErr("No BitGraph found for that number or hash.");
    } catch {
      setSearchErr("Search failed, try again.");
    } finally {
      setSearching(false);
    }
  }, [query, searching]);

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
        .xp-open { display:inline-flex; align-items:center; gap:4px; flex-shrink:0; color:#0065A4; font-size:13px; font-weight:600; letter-spacing:-0.01em; border:1px solid #0065A4; border-radius:0; padding:4px 12px; background:#fff; transition:background .15s, color .15s; }
        @media (hover:hover){
          .xp-row:hover { background:#f3f5f7; }
          .xp-row:hover .xp-open { background:#0065A4; color:#fff; }
        }
      `}</style>

      {/* Search — jump to any BitGraph by its number or hash */}
      <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginBottom: searchErr ? 6 : 12 }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (searchErr) setSearchErr(""); }}
          placeholder="BitGraph number or hash"
          aria-label="Search BitGraphs by number or hash"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{ flex: 1, minWidth: 0, height: 44, padding: "0 14px", border: "1px solid #d0d5dd", borderRadius: 0, fontSize: 14, background: "#fff", color: "#111827", outline: "none" }}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          style={{ height: 44, padding: "0 20px", border: "none", borderRadius: 0, background: "#0065A4", color: "#fff", fontSize: 14, fontWeight: 600, cursor: searching || !query.trim() ? "default" : "pointer", opacity: searching || !query.trim() ? 0.55 : 1, flexShrink: 0, letterSpacing: "-0.01em" }}
        >
          {searching ? "…" : "Search"}
        </button>
      </form>
      {searchErr && <div style={{ marginBottom: 12, fontSize: 13, color: "#dc2626" }}>{searchErr}</div>}

      {/* Stream — generic ledger rows; type and specifics live on the drill-in */}
      <div style={{ background: "#fff", border: "1px solid #d0d5dd" }}>
        {loading && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Reading the ledger…</div>}
        {error && !loading && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Ledger unavailable right now.</div>}

        {!loading && !error && entries.map((e) => {
          const isAnchor = e.type === "anchor";
          const isInterval = e.type === "interval";
          // Interval recurrences are the same bytes as an anchor 25 anchors
          // back, re-committed at a new position: distinct label + violet so
          // they read differently from anchors (gray) and files (blue).
          const tagLabel = isAnchor ? "anchor" : isInterval ? "interval" : "file";
          const tagColor = isAnchor ? "#9ca3af" : isInterval ? "#7c3aed" : "#0065A4";
          const tagWeight = isAnchor ? 400 : 600;
          // ?counter= pins the drill-in to THIS row's causal position; the
          // same bytes can occupy several (BitGraphed more than once).
          return (
            <a key={e.counter} href={`/proof/${e.digest}?counter=${encodeURIComponent(e.counter)}`} target="_blank" rel="noopener" className={freshIds.has(e.counter) ? "xp-row xp-row-fresh" : "xp-row"}>
              <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 400, color: "#374151" }}>
                BitGraph
                <span style={{ marginLeft: 7, fontSize: 14, fontWeight: 700, color: "#0065A4", fontVariantNumeric: "tabular-nums", fontFamily: mono }}>#{fmt(e.counter)}</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 12, color: tagColor, fontWeight: tagWeight, whiteSpace: "nowrap" }}>
                {tagLabel}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#9ca3af", fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                {e.hashShort}…
              </span>
              <span className="xp-open">
                Open
                <span aria-hidden style={{ fontSize: 17, lineHeight: 1, fontWeight: 600 }}>›</span>
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

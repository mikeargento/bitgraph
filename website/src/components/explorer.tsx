"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { takeWarm, ROLL_FEED_KEY } from "@/lib/warm";

type Entry = {
  counter: number;
  type: "proof" | "anchor" | "interval";
  digest: string;
  hashShort: string;
  blockNumber: number | null;
  etherscanUrl: string | null;
  isNew?: true;
  at?: number;
  // URL-safe epochId. Day rolls can span epochs and counters repeat across
  // them, so identity and proof links use (epoch, counter), not counter alone.
  ep?: string;
};

type FeedResp = { entries?: Entry[]; nextBefore?: number | null; nextEpoch?: string | null; hasMore?: boolean };

// Row identity that survives epoch boundaries (day rolls). Live-feed rows are
// all one epoch, where this degrades to the counter as before.
const rowId = (e: Entry) => `${e.ep ?? ""}:${e.counter}`;

// Compact recorded time for a roll row, e.g. "Jul 17, 9:22 PM". More useful
// than the truncated hash it replaces (nobody reads a proof by 10 hash chars).
const fmtWhen = (ms?: number) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const fmt = (n: number) => n.toLocaleString();

export function Explorer({ title, day, aside, subnav }: { title?: React.ReactNode; day?: string; aside?: React.ReactNode; subnav?: React.ReactNode }) {
  // Seed first paint from a warm Roll feed if the nav warmed one on hover/focus.
  // Only the default view (files only, no cursor) is warmed, so this seeds just
  // the initial render; the effect below reconciles against a live fetch.
  // Day rolls (sealed past days) never seed from the live warm slot.
  const seeded = (() => { if (day) return null; const w = takeWarm<FeedResp>(ROLL_FEED_KEY); return w && "data" in w ? w.data : null; })();
  const [entries, setEntries] = useState<Entry[]>(() => seeded?.entries ?? []);
  // Counters that arrived via the live poll (not the initial load), so only
  // those rows get the arrival flash. Grows slowly; the animation runs once.
  const [freshIds, setFreshIds] = useState<Set<number>>(() => new Set());
  // Counters currently wearing "new!". The server stamps isNew on file rows
  // whose ledger write is seconds old; each tag then lives ~30s from when this
  // client first renders it, so "new" means "just landed", not "recent".
  const [newIds, setNewIds] = useState<Set<number>>(() => new Set());
  const NEW_TAG_MS = 30_000;
  const noteNew = useCallback((es: Entry[]) => {
    const tagged = es.filter((e) => e.isNew && e.type === "proof").map((e) => e.counter);
    if (!tagged.length) return;
    setNewIds((prev) => new Set([...prev, ...tagged]));
    setTimeout(() => setNewIds((prev) => {
      const next = new Set(prev);
      for (const c of tagged) next.delete(c);
      return next;
    }), NEW_TAG_MS);
  }, []);
  const [nextBefore, setNextBefore] = useState<number | null>(() => seeded?.nextBefore ?? null);
  // Day-roll cursor scope: counters repeat across epochs, so the resume point
  // is (epoch, counter). Null outside day mode.
  const [nextEpoch, setNextEpoch] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(() => seeded ? !!seeded.hasMore : true);
  const [loading, setLoading] = useState(() => !seeded);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);


  // Anchors are the clock ticking, not the photos: hidden by default so the
  // roll reads as files. The toggle refetches; ?files=1 lets the server skip
  // anchor objects via the anchors/{epoch}/ index instead of GETting each.
  const [showAnchors, setShowAnchors] = useState(false);
  // Search: resolve a hash to a proof via /api/search, which verifies the proof
  // is retrievable before handing back a link, then navigate. Searching by
  // BitGraph number was removed; see the endpoint for why it can never work.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const runSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      if (data.found && data.digest) {
        window.location.assign(`/proof/${data.digest}`);
      } else {
        // A number gets its own answer. It is the obvious thing to type, having
        // just been read off a row, and a plain "not found" would say the
        // recording was gone when the truth is the number never named it.
        setSearchError(data.reason === "number"
          ? "A number is a position within one day, and every day restarts it. Search by hash."
          : "No BitGraph found for that hash.");
        setSearching(false);
      }
    } catch {
      setSearchError("Search failed. Try again.");
      setSearching(false);
    }
  }, [query, searching]);

  const busyRef = useRef(false);
  const topRef = useRef(seeded?.entries?.[0]?.counter ?? 0);
  // The initial-load effect re-runs when the anchors toggle flips the feed mode;
  // only the very first run should preserve warm-seeded rows (a toggle is a real
  // reset). The reconcile fetch re-runs noteNew on the fresh rows, so any "new!"
  // tags settle a moment after the seeded paint.
  const firstRunRef = useRef(true);

  const feedUrl = useCallback((before?: number | null, bepoch?: string | null) => {
    // The no-cursor live files URL must stay byte-identical to ROLL_FEED_KEY
    // (warm slots key by URL string), so the live path keeps its exact shape.
    if (!day) return `/api/explorer?${showAnchors ? "" : "files=1"}${before != null ? `${showAnchors ? "" : "&"}before=${before}` : ""}`;
    const p = new URLSearchParams({ day });
    if (!showAnchors) p.set("files", "1");
    if (before != null) {
      p.set("before", String(before));
      if (bepoch) p.set("bepoch", bepoch);
    }
    return `/api/explorer?${p.toString()}`;
  }, [showAnchors, day]);

  // An anchor-only stretch (day rolls especially: a sparse day inside a big
  // pre-rotation epoch) legitimately yields empty pages that still carry a
  // cursor. Absorb them here, bounded, so a page the user sees always has
  // either rows or a real end — chaining must not depend on the scroll
  // sentinel's IntersectionObserver, which won't fire in a hidden tab.
  const fetchChain = useCallback(async (
    before?: number | null, bepoch?: string | null, signal?: AbortSignal,
  ): Promise<FeedResp> => {
    const acc: Entry[] = [];
    let nb: number | null = before ?? null;
    let ne: string | null = bepoch ?? null;
    let hm = true;
    for (let hop = 0; hop < 12; hop++) {
      const url = hop === 0 ? feedUrl(before, bepoch) : feedUrl(nb, ne);
      const r = await fetch(url, signal ? { signal } : undefined);
      if (!r.ok) throw new Error(`feed ${r.status}`);
      const j: FeedResp = await r.json();
      acc.push(...(j.entries || []));
      nb = j.nextBefore ?? null;
      ne = j.nextEpoch ?? null;
      hm = !!j.hasMore;
      if (acc.length > 0 || !hm || nb == null) break;
    }
    return { entries: acc, nextBefore: nb, nextEpoch: ne, hasMore: hm };
  }, [feedUrl]);

  // Initial load, re-run when the anchors toggle flips the feed mode. A cold
  // request can be slow while the endpoint discovers the epoch head, so retry
  // a few times with a per-attempt timeout rather than hanging forever on one
  // stalled fetch.
  useEffect(() => {
    let cancelled = false;
    const isFirst = firstRunRef.current;
    firstRunRef.current = false;
    // On the first run with warm-seeded rows, keep them on screen and just
    // reconcile below (no blank flash). Otherwise (a toggle, or no warm data),
    // reset to the loading state as before.
    if (isFirst && seeded) {
      setError(false);
    } else {
      setEntries([]);
      setFreshIds(new Set());
      setNewIds(new Set());
      setNextBefore(null);
      setNextEpoch(null);
      setHasMore(true);
      setLoading(true);
      setError(false);
      topRef.current = 0;
    }
    (async () => {
      // Fast path: if a warm fetch is still in flight (hover then a quick
      // click), await it instead of firing a duplicate request.
      if (isFirst && !seeded) {
        const w = takeWarm<FeedResp>(feedUrl());
        if (w && "promise" in w) {
          try {
            const j = await w.promise;
            if (cancelled) return;
            setEntries(j.entries || []);
            noteNew(j.entries || []);
            setNextBefore(j.nextBefore ?? null);
            setNextEpoch(j.nextEpoch ?? null);
            setHasMore(!!j.hasMore);
            topRef.current = j.entries?.[0]?.counter ?? 0;
            setLoading(false);
            return;
          } catch { /* fall through to the normal retry loop */ }
        }
      }
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 20000);
          const j = await fetchChain(undefined, undefined, ctrl.signal);
          clearTimeout(to);
          if (cancelled) return;
          setEntries(j.entries || []);
          noteNew(j.entries || []);
          setNextBefore(j.nextBefore ?? null);
          setNextEpoch(j.nextEpoch ?? null);
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
  }, [fetchChain]);

  // Instant arrivals: the drop flow on this page dispatches each successful
  // recording the moment its commit returns, so the dropper's Roll never
  // waits out the poll. Same flash + "new!" treatment as polled arrivals;
  // topRef advances so the next poll doesn't re-add these counters.
  useEffect(() => {
    if (day) return; // a sealed day's roll cannot receive live arrivals
    const onRecorded = (ev: Event) => {
      const detail = ((ev as CustomEvent<Entry[]>).detail || []).filter((e) => e.counter > 0);
      if (!detail.length) return;
      setEntries((prev) => {
        const seen = new Set(prev.map((p) => p.counter));
        const add = detail.filter((e) => !seen.has(e.counter)).sort((a, b) => b.counter - a.counter);
        return add.length ? [...add, ...prev] : prev;
      });
      topRef.current = Math.max(topRef.current, ...detail.map((e) => e.counter));
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const e of detail) next.add(e.counter);
        return next;
      });
      noteNew(detail);
    };
    window.addEventListener("bitgraph:recorded", onRecorded);
    return () => window.removeEventListener("bitgraph:recorded", onRecorded);
  }, [noteNew, day]);

  // Live poll, two tiers: a tiny head check every ~3s, and a feed fetch only
  // when the head actually advances. The head endpoint (/api/roll/head) is
  // never served long-stale (short s-maxage, no SWR), which is what makes
  // arrivals feel instant; the heavier feed page keeps its hour-long SWR and
  // is fetched with a ?n={head} cache-buster, so the CDN key changes exactly
  // when the content does and every open Roll shares one origin fetch per
  // change. Hidden tabs pause (background timers are throttled anyway and
  // fetches there are wasted); regaining visibility checks immediately, which
  // also heals a tab that slept through arrivals. Day rolls are sealed
  // history: nothing to poll for.
  useEffect(() => {
    if (day) return;
    let disposed = false;
    let inFlight = false;
    let liveEpoch: string | null = null;
    const bustedFeedUrl = (n: number) => {
      const u = feedUrl();
      return `${u}${u.endsWith("?") ? "" : "&"}n=${n}`;
    };
    const tick = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const hr = await fetch("/api/roll/head");
        if (!hr.ok) return;
        const h = (await hr.json()) as { epoch?: string; head?: number };
        if (!h.epoch || !h.head) return;
        if (liveEpoch !== null && liveEpoch !== h.epoch) {
          // Daily rotation at 23:59 UTC: the live Roll becomes the new day's
          // roll. Old-epoch counters are incomparable, so replace instead of
          // prepending across the boundary.
          liveEpoch = h.epoch;
          const r = await fetch(bustedFeedUrl(h.head));
          if (!r.ok) return;
          const j: FeedResp = await r.json();
          if (disposed) return;
          setEntries(j.entries || []);
          noteNew(j.entries || []);
          setNextBefore(j.nextBefore ?? null);
          setNextEpoch(j.nextEpoch ?? null);
          setHasMore(!!j.hasMore);
          topRef.current = j.entries?.[0]?.counter ?? 0;
          return;
        }
        liveEpoch = h.epoch;
        if (h.head <= topRef.current) return;
        const r = await fetch(bustedFeedUrl(h.head));
        if (!r.ok) return;
        const j = await r.json();
        if (disposed) return;
        const fresh: Entry[] = (j.entries || []).filter((e: Entry) => e.counter > topRef.current);
        if (fresh.length) {
          topRef.current = fresh[0].counter;
          setEntries((prev) => [...fresh, ...prev]);
          noteNew(fresh);
          setFreshIds((prev) => {
            const next = new Set(prev);
            for (const e of fresh) next.add(e.counter);
            return next;
          });
        }
      } catch { /* transient, ignore */ }
      finally { inFlight = false; }
    };
    const id = setInterval(tick, 3000);
    const onVis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [feedUrl, day, noteNew]);

  const loadMore = useCallback(async () => {
    if (busyRef.current || nextBefore == null || !hasMore) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      const j = await fetchChain(nextBefore, nextEpoch);
      setEntries((prev) => {
        const seen = new Set(prev.map(rowId));
        return [...prev, ...(j.entries || []).filter((e: Entry) => !seen.has(rowId(e)))];
      });
      setNextBefore(j.nextBefore ?? null);
      setNextEpoch(j.nextEpoch ?? null);
      setHasMore(!!j.hasMore);
    } catch { /* keep what we have */ }
    finally { busyRef.current = false; setLoadingMore(false); }
  }, [nextBefore, nextEpoch, hasMore, fetchChain]);

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
        @keyframes xpArrive { 0%{opacity:0;transform:translateY(-8px);background:#f0f6ff} 50%{opacity:1;transform:none;background:#f0f6ff} 100%{opacity:1;transform:none;background:transparent} }
        .xp-row { display:flex; align-items:center; gap:12px; padding:14px 16px; background:#fff; border:1px solid #d0d5dd; text-decoration:none; animation:xpIn .25s ease-out; transition:background .12s; }
        /* Live arrivals only: a stronger slide plus a brief brand-blue flash
           that ends fully transparent, so nothing tinted is left behind. */
        .xp-row-fresh { animation: xpArrive 1.4s ease-out; }
        /* Interval rows: a violet wash plus a violet left rail so they read as
           a distinct kind of row at a glance, not just a colored label. */
        .xp-row-interval { background:#f4f1fe; box-shadow: inset 3px 0 0 0 #7c3aed; }
        .xp-open { color:#0065A4; transition: color .15s; }
        @media (hover:hover){
          .xp-row:hover { background:#f3f5f7; }
          .xp-row-interval:hover { background:#ece5fd; }
          .xp-row:hover .xp-open { color:#004b7a; }
        }
        @keyframes xpSkel { 0%{background-position:100% 0} 100%{background-position:0 0} }
        .xp-skel { background:linear-gradient(90deg,#edeff1 25%,#e0e3e7 37%,#edeff1 63%); background-size:400% 100%; animation:xpSkel 1.4s ease-in-out infinite; border-radius:3px; }
        @media (prefers-reduced-motion: reduce){ .xp-skel{ animation:none; } }
      `}</style>

      {/* Heading: title + subtitle alone, full width, nothing competing. */}
      {title != null && <div style={{ marginBottom: 12 }}>{title}</div>}

      {/* THE nav line — one stratum for everything: the day-flip pair on the
          left (a classic stepper, back before forward), view controls on the
          right (anchors toggle, then the calendar). Sized to hold one line at
          375px with nothing wrapping; the All-rolls label collapses to its
          glyph on phones. Anchors hidden by default: the roll shows the
          photos, not the clock. */}
      {(subnav != null || aside != null) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>{subnav}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#4b5563", cursor: "pointer", userSelect: "none", flexShrink: 0, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={showAnchors}
                onChange={(ev) => setShowAnchors(ev.target.checked)}
                style={{ accentColor: "#0065A4", width: 13, height: 13 }}
              />
              Show anchors
            </label>
            {aside}
          </div>
        </div>
      )}

      {/* Search — jump straight to a BitGraph by its hash. Submitting resolves
          + verifies via /api/search, then navigates to the proof.

          It searched by BitGraph number until 2026-08-04, which was the natural
          thing to offer here and cannot be made correct: a counter is a
          position within one epoch, an epoch is one UTC day, so the number on a
          row from last week names a different recording today. For anyone
          holding the file, dropping it is still the better path; this is for
          anyone holding only a hash, out of a proof.json or a proof page. */}
      <form onSubmit={runSearch} style={{ display: "flex", gap: 8, marginBottom: searchError ? 6 : 12 }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearchError(null); }}
          placeholder="Search by hash"
          aria-label="Search by hash"
          style={{ flex: 1, minWidth: 0, padding: "10px 14px", fontSize: 14, color: "#111827", background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0, outline: "none" }}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          style={{ flexShrink: 0, padding: "10px 18px", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "#fff", background: "#0065A4", border: "none", borderRadius: 0, cursor: searching || !query.trim() ? "default" : "pointer", opacity: searching || !query.trim() ? 0.55 : 1 }}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {searchError && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#dc2626" }}>{searchError}</div>
      )}

      {/* Stream — generic ledger rows; type and specifics live on the drill-in.
          Each row is its own bordered card with a gap between, so the Roll reads
          as separate items rather than one dense table. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && (
          <>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} role="status">Reading the ledger…</span>
            {/* A skeleton of ledger rows — same row chrome (# left, tag, date
                right, Open chevron) as the real stream, so it lands in place
                with no jump when the entries arrive. */}
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={`skel-${i}`} className="xp-row" style={{ pointerEvents: "none" }} aria-hidden>
                <span className="xp-skel" style={{ width: 60, height: 14, flexShrink: 0 }} />
                <span className="xp-skel" style={{ width: 34, height: 12, flexShrink: 0 }} />
                <span style={{ flex: 1 }} />
                <span className="xp-skel" style={{ width: 84, height: 12, flexShrink: 0 }} />
                <span aria-hidden style={{ display: "inline-flex", flexShrink: 0, color: "#c7ccd1" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                </span>
              </div>
            ))}
          </>
        )}
        {error && !loading && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Ledger unavailable right now.</div>}

        {!loading && !error && (showAnchors ? entries : entries.filter((e) => e.type === "proof")).map((e) => {
          const isAnchor = e.type === "anchor";
          const isInterval = e.type === "interval";
          // Interval recurrences are the same bytes as an anchor 25 anchors
          // back, re-committed at a new position: distinct label + violet so
          // they read differently from anchors (gray) and files (blue).
          const tagLabel = isAnchor ? "anchor" : isInterval ? "interval" : "file";
          const tagColor = isAnchor ? "#4b5563" : isInterval ? "#7c3aed" : "#0065A4";
          const tagWeight = isAnchor ? 400 : 600;
          // ?counter=&epoch= pin the drill-in to THIS row's causal position;
          // the same bytes can occupy several (BitGraphed more than once), and
          // counters repeat across epochs.
          return (
            <a key={rowId(e)} href={`/proof/${e.digest}?counter=${encodeURIComponent(e.counter)}${e.ep ? `&epoch=${encodeURIComponent(e.ep)}` : ""}`} className={`xp-row${isInterval ? " xp-row-interval" : ""}${freshIds.has(e.counter) ? " xp-row-fresh" : ""}`}>
              <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: "#0065A4", fontVariantNumeric: "tabular-nums", fontFamily: mono }}>
                #{fmt(e.counter)}
              </span>
              <span style={{ flexShrink: 0, fontSize: 12, color: tagColor, fontWeight: tagWeight, whiteSpace: "nowrap" }}>
                {tagLabel}
              </span>
              {/* Just-landed rows only; expires ~30s after first render, same
                  green as the live-arrival flash. */}
              {newIds.has(e.counter) && (
                <span style={{ flexShrink: 0, fontSize: 12, color: "#0065A4", fontWeight: 700, whiteSpace: "nowrap" }}>
                  (New)
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#4b5563", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtWhen(e.at)}
              </span>
              <span className="xp-open" aria-label="Open" style={{ display: "inline-flex", flexShrink: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
              </span>
            </a>
          );
        })}

        {!loading && !error && day && entries.filter((e) => showAnchors || e.type === "proof").length === 0 && !hasMore && (
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
            {showAnchors ? "No recordings on this day." : "No files recorded on this day."}
          </div>
        )}
        {!loading && !error && (
          <div ref={sentinel} style={{ padding: 16, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
            {loadingMore ? "Loading…" : hasMore ? " " : day ? (entries.length ? "End of this day's roll" : " ") : "Beginning of epoch"}
          </div>
        )}
      </div>
    </div>
  );
}

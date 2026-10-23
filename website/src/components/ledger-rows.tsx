"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useRef, useState } from "react";
import type { LedgerRow } from "@/lib/running-ledger";

/**
 * The ledger's rows, live (Mike, 2026-10-17: "bitgraph ledger needs to dynamically load too. it seems to lag or
 * need refreshes"). Today's page asks /api/ledger/rows for what came after its newest row every 2 s while the tab
 * is visible, and puts new BitGraphs on top as they are made; nothing re-reads the rows already shown. The newest
 * 200 come with the page; Show older fetches the 200 before the oldest shown.
 */
const fmt = (n: number | string) => Number(n).toLocaleString("en-US");
function when(ms: number): string {
  const d = new Date(ms);
  const md = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const t = d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${md}, ${t} UTC`;
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** An epoch's first BitGraph (counts 1, 2) is, from enclave v13, a read of the latest Base block
 *  (epoch-floor.json). Shown only when the file served for the epoch hashes, here, to this row's digest. */
function useEpochStart(r: LedgerRow): number | null {
  const [block, setBlock] = useState<number | null>(null);
  useEffect(() => {
    if (r.nonceCounter !== "1" || !r.digest) return;
    const epoch = r.key.split("/")[1];
    if (!epoch) return;
    let gone = false;
    (async () => {
      const res = await fetch(`/api/epoch-floors/${epoch}`).catch(() => null);
      if (!res || !res.ok) return;
      const j = (await res.json()) as { file?: string; block?: { number?: number } };
      if (typeof j.file !== "string") return;
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(j.file)));
      let b = ""; for (const x of h) b += String.fromCharCode(x);
      const urlSafe = btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (!gone && urlSafe === r.digest && typeof j.block?.number === "number") setBlock(j.block.number);
    })().catch(() => {});
    return () => { gone = true; };
  }, [r.key, r.digest, r.nonceCounter]);
  return block;
}

function Row({ r }: { r: LedgerRow }) {
  const epochStart = useEpochStart(r);
  const inner = (
    <>
      {/* The epoch's first BitGraph leads with "Genesis", its number where "Genesis" was (Mike, 2026-10-20). */}
      <span className="rl-num">{epochStart !== null ? "Genesis" : `#${fmt(r.counter)}`}</span>
      {/* An epoch's first BitGraph reads "Genesis"; its Base block is in the tooltip and on its proof page (Mike, 2026-10-20:
          "this wraps bad ... maybe just call that first block genesis"). */}
      <span className="rl-counts" title={epochStart !== null ? `Epoch start: Base block ${fmt(epochStart)}` : undefined}>{r.nonceCounter ? `counts ${fmt(r.nonceCounter)}, ${fmt(r.counter)}` : ""}{r.anchor ? " · anchor" : ""}{epochStart !== null ? ` · #${fmt(r.counter)}` : ""}</span>
      <span className="rl-hash" title="SHA-256 of the bound content">{r.digest ?? r.proofHash}</span>
      {r.recordedMs !== null && (
        <span className="rl-when">
          <span className="rl-when-long">{when(r.recordedMs)}</span>
          <span className="rl-when-short">{clock(r.recordedMs)}</span>
        </span>
      )}
    </>
  );
  return r.digest
    ? <a href={`/proof/${r.digest}`} className="xp-row xp-row-base rl-row rl-link">{inner}</a>
    : <div className="xp-row xp-row-base rl-row">{inner}</div>;
}

export function LedgerRows({ day, live, initial, newestKey, hasOlder }: { day: string; live: boolean; initial: LedgerRow[]; newestKey: string | null; hasOlder: boolean }) {
  const [rows, setRows] = useState<LedgerRow[]>(initial);
  const [older, setOlder] = useState(hasOlder);
  const [busy, setBusy] = useState(false);
  const newest = useRef<string | null>(newestKey);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let inFlight = false;
    const poll = async () => {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const r = await fetch(`/api/ledger/rows?after=${encodeURIComponent(newest.current ?? "")}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { rows: LedgerRow[]; newestKey: string | null };
          if (j.rows.length) {
            const seen = new Set<string>();
            setRows((cur) => [...j.rows, ...cur].filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true))));
          }
          if (j.newestKey) newest.current = j.newestKey;
          // A new UTC day: today's page is a new page.
          if (new Date().toISOString().slice(0, 10) !== day) window.location.reload();
        }
      } catch { /* a missed poll is not a verdict; the next one tries again */ }
      inFlight = false;
    };
    const t = setInterval(poll, 2000);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [live, day]);

  const showOlder = async () => {
    const oldest = rows[rows.length - 1];
    if (!oldest) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/ledger/rows?day=${day}&before=${encodeURIComponent(oldest.key)}`);
      if (r.ok) {
        const j = (await r.json()) as { rows: LedgerRow[]; hasOlder: boolean };
        setRows((cur) => [...cur, ...j.rows]);
        setOlder(j.hasOlder);
      }
    } finally { setBusy(false); }
  };

  if (rows.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>{live ? "No BitGraphs yet today. New ones appear here as they are made." : "No BitGraphs on this day."}</div>;
  }
  return (
    <>
      <div className="rl-rows">{rows.map((r) => <Row key={r.key} r={r} />)}</div>
      {older && (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={busy} onClick={() => void showOlder()}>{busy ? "Loading…" : "Show older"}</button>
        </div>
      )}
    </>
  );
}

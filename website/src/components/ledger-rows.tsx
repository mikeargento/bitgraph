"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LedgerItem, LedgerRow } from "@/lib/running-ledger";
import type { ReadsRow, TimelineRead } from "@/lib/timeline-ledger-core";
import { proofFeedKey, warm } from "@/lib/warm";

/**
 * The ledger's rows, live (2026-10-17), so the page neither lags nor needs a refresh. Today's page asks /api/ledger/rows for what came after its newest row every 2 s while the tab
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
/** The viewer's own time, for the hover: the page itself stays in UTC, the ledger's days and the chains' clock. */
function local(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

/** An epoch's first BitGraph (counts 1, 2) is, from enclave v13, a read of the latest Base block
 *  (epoch-floor.json). Shown only when the file served for the epoch hashes, here, to this row's digest. */
function useEpochStart(r: LedgerRow, firstOfEpoch: boolean): number | null {
  const [block, setBlock] = useState<number | null>(null);
  useEffect(() => {
    // From the block timeline on, the genesis record may follow a few reads made while the Base write was pending:
    // it is then the epoch's first file row. Either way the file served for the epoch must hash to this row's digest.
    if ((r.nonceCounter !== "1" && !firstOfEpoch) || !r.digest) return;
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
  }, [r.key, r.digest, r.nonceCounter, firstOfEpoch]);
  return block;
}

function Row({ r, firstOfEpoch }: { r: LedgerRow; firstOfEpoch: boolean }) {
  const epochStart = useEpochStart(r, firstOfEpoch);
  const inner = (
    <>
      {/* The epoch's first BitGraph leads with "Genesis", its number where "Genesis" was (2026-10-20). */}
      <span className="rl-num">{epochStart !== null ? "Genesis" : `#${fmt(r.counter)}`}</span>
      {/* An epoch's first BitGraph reads "Genesis"; its Base block is in the tooltip and on its proof page (2026-10-20):
          the block number wrapped badly, and "Genesis" is short. */}
      <span className="rl-counts" title={epochStart !== null ? `Epoch start: Base block ${fmt(epochStart)}` : undefined}>{r.nonceCounter ? `counts ${fmt(r.nonceCounter)}, ${fmt(r.counter)}` : ""}{r.anchor ? " · anchor" : ""}{epochStart !== null ? ` · #${fmt(r.counter)}` : ""}</span>
      <span className="rl-hash" title="SHA-256 of the bound content">{r.digest ?? r.proofHash}</span>
      {r.recordedMs !== null && (
        <span className="rl-when" title={local(r.recordedMs)}>
          <span className="rl-when-long">{when(r.recordedMs)}</span>
          <span className="rl-when-short">{clock(r.recordedMs)}</span>
        </span>
      )}
    </>
  );
  if (!r.digest) return <div className="xp-row xp-row-base rl-row">{inner}</div>;
  // The row's own position goes in the link: the same bytes bound twice are two rows, and without it both opened the
  // first. An in-app link keeps the loaded app, and intent (hover, focus, touch) starts the proof's fetch, which the
  // proof page picks up from the warm slot instead of sending its own.
  const digest = r.digest;
  const epoch = r.key.split("/")[1];
  const intent = () => warm(proofFeedKey(digest, r.counter, epoch));
  return (
    <Link href={`/proof/${digest}?counter=${r.counter}&epoch=${epoch}`} className="xp-row xp-row-base rl-row rl-link" onMouseEnter={intent} onFocus={intent} onTouchStart={intent}>
      {inner}
    </Link>
  );
}

const isReads = (x: LedgerItem): x is ReadsRow => (x as ReadsRow).kind === "reads";
const CHAIN_NAME: Record<string, string> = { base: "Base", ethereum: "Ethereum" };

/** What a reads row's records are, in words. */
function readsLabel(r: ReadsRow): string {
  const n = fmt(r.count);
  const one = r.count === 1;
  if (r.state === "recorded") return `${n} block read${one ? "" : "s"}`;
  if (r.state === "uploading") return `${n} block read${one ? "" : "s"}, uploading (the host uploads each minute)`;
  if (r.state === "missing") return `${n} record${one ? "" : "s"}, not all on record`;
  return `${n} record${one ? "" : "s"}, not listed (before the block timeline)`;
}

/**
 * The block reads between two file rows (timeline-ledger.ts): one row standing for their counts, opened in place to
 * list each read with its chain, block number and the enclave's time. Every count of the sequence is either a file's
 * row or inside one of these.
 */
function ReadsRowView({ r }: { r: ReadsRow }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  const [reads, setReads] = useState<{ to: number; reads: TimelineRead[]; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Fetched when opened, and again when the run has grown since (the newest run grows while the page is live).
    if (!open || (reads && reads.to === r.to) || r.state === "unlisted") return;
    let gone = false;
    (async () => {
      const res = await fetch(`/api/ledger/reads?epoch=${r.epoch}&from=${r.from}&to=${r.to}`, { cache: "no-store" }).catch(() => null);
      if (gone) return;
      if (!res || !res.ok) { setFailed(true); return; }
      setFailed(false);
      setReads({ to: r.to, ...((await res.json()) as { reads: TimelineRead[]; truncated: boolean }) });
    })().catch(() => setFailed(true));
    return () => { gone = true; };
  }, [open, reads, r.epoch, r.from, r.to, r.state]);
  const counts = r.from - 1 === r.to - 1 ? `count ${fmt(r.to)}` : `counts ${fmt(r.from - 1)}–${fmt(r.to)}`;
  return (
    <div className={`rl-reads rl-reads-${r.state}`}>
      <button type="button" className="xp-row xp-row-base rl-row rl-reads-head" onClick={toggle} aria-expanded={open}>
        <span className="rl-num">{open ? "▾" : "▸"} Reads</span>
        <span className="rl-counts">{counts}</span>
        <span className="rl-hash">{readsLabel(r)}</span>
      </button>
      {open && (
        <div className="rl-reads-list">
          {failed && <div className="rl-reads-note">The reads could not be loaded. Try again.</div>}
          {!reads && !failed && r.state !== "unlisted" && <div className="rl-reads-note">Loading…</div>}
          {reads?.reads.map((x) => (
            <div key={x.counter} className="xp-row xp-row-base rl-row rl-read">
              <span className="rl-num">#{fmt(x.counter)}</span>
              <span className="rl-counts">counts {fmt(x.counter - 1)}, {fmt(x.counter)}</span>
              <span className="rl-hash">{x.kind === "block" ? `${CHAIN_NAME[x.chain ?? ""] ?? x.chain ?? "Block"} block ${x.number !== undefined ? fmt(x.number) : "?"}` : x.kind === "genesis" ? "Epoch genesis" : "File (not in the index yet)"}</span>
              {x.recordedMs !== null && (
                <span className="rl-when" title={local(x.recordedMs)}>
                  <span className="rl-when-long">{when(x.recordedMs)}</span>
                  <span className="rl-when-short">{clock(x.recordedMs)}</span>
                </span>
              )}
            </div>
          ))}
          {reads && reads.reads.length < r.count && !reads.truncated && r.state !== "uploading" && (
            <div className="rl-reads-note">{fmt(r.count - reads.reads.length)} of these counts are on no record.</div>
          )}
          {reads?.truncated && <div className="rl-reads-note">The newest {fmt(reads.reads.length)} are listed.</div>}
        </div>
      )}
    </div>
  );
}

export function LedgerRows({ day, live, initial, newestKey, hasOlder }: { day: string; live: boolean; initial: LedgerItem[]; newestKey: string | null; hasOlder: boolean }) {
  const [rows, setRows] = useState<LedgerItem[]>(initial);
  const rowsRef = useRef<LedgerItem[]>(initial);
  rowsRef.current = rows;
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
          const j = (await r.json()) as { rows: LedgerItem[]; newestKey: string | null };
          if (j.rows.length) {
            // The reads above the newest file row come back recounted every poll: they replace the ones shown.
            const seen = new Set<string>();
            setRows((cur) => {
              const firstFile = cur.findIndex((x) => !isReads(x));
              const rest = firstFile < 0 ? [] : cur.slice(firstFile);
              return [...j.rows, ...rest].filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
            });
          }
          if (j.newestKey) newest.current = j.newestKey;
          // A row below the newest that was still uploading when it was made: ask for its state again.
          const stale = rowsRef.current.filter((x, i) => isReads(x) && x.state === "uploading" && i > 0 && rowsRef.current.slice(0, i).some((y) => !isReads(y))) as ReadsRow[];
          for (const x of stale.slice(0, 4)) {
            const sr = await fetch(`/api/ledger/span?epoch=${x.epoch}&from=${x.from}&to=${x.to}`, { cache: "no-store" }).catch(() => null);
            if (!sr || !sr.ok) continue;
            const { state } = (await sr.json()) as { state: ReadsRow["state"] };
            if (state !== x.state) setRows((cur) => cur.map((y) => (y.key === x.key && isReads(y) ? { ...y, state } : y)));
          }
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
    const oldest = [...rows].reverse().find((x): x is LedgerRow => !isReads(x));
    if (!oldest) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/ledger/rows?day=${day}&before=${encodeURIComponent(oldest.key)}`);
      if (r.ok) {
        const j = (await r.json()) as { rows: LedgerItem[]; hasOlder: boolean };
        setRows((cur) => [...cur, ...j.rows]);
        setOlder(j.hasOlder);
      }
    } finally { setBusy(false); }
  };

  if (rows.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>{live ? "No BitGraphs yet today. New ones appear here as they are made." : "No BitGraphs on this day."}</div>;
  }
  // An epoch's first file row: the next item is its epoch's reads from the start, or nothing older in its epoch.
  const epochOf = (x: LedgerItem) => (isReads(x) ? x.epoch : x.key.split("/")[1]);
  const firstOfEpoch = (i: number): boolean => {
    const next = rows[i + 1];
    if (!next || epochOf(next) !== epochOf(rows[i]!)) return !older;
    return isReads(next) && next.from === 2 && (!rows[i + 2] || epochOf(rows[i + 2]!) !== epochOf(rows[i]!));
  };
  return (
    <>
      <div className="rl-rows">
        {rows.map((r, i) => isReads(r)
          ? <ReadsRowView key={r.key} r={r} />
          : <Row key={r.key} r={r} firstOfEpoch={firstOfEpoch(i)} />)}
      </div>
      {older && (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={busy} onClick={() => void showOlder()}>{busy ? "Loading…" : "Show older"}</button>
        </div>
      )}
    </>
  );
}

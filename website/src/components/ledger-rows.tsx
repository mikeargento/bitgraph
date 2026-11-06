"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import type { LedgerItem, LedgerRow } from "@/lib/running-ledger";
import type { ReadsRow } from "@/lib/timeline-ledger-core";
import type { RollRoot } from "@/lib/ceilings";
import { proofFeedKey, warm } from "@/lib/warm";

/**
 * The ledger's rows, live (2026-10-17), so the page neither lags nor needs a refresh. Today's page asks /api/ledger/rows for what came after its newest row every 2 s while the tab
 * is visible, and puts new BitGraphs on top as they are made; nothing re-reads the rows already shown. The newest
 * 200 come with the page; Show older fetches the 200 before the oldest shown.
 */
const fmt = (n: number | string) => Number(n).toLocaleString("en-US");
/** When, the way a phone's camera roll says it, in the viewer's own time: "just now" and "12 minutes ago" within the
 *  hour, then "Today, 8:12 PM", "Yesterday, 3:40 PM", "Nov 1, 3:42 PM", and the year once it is not this one. */
function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const d = new Date(ms), today = new Date(now);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  return `${date}, ${time}`;
}
/** A clock for "ago" that ticks once a minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return now;
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
  const now = useNow();
  // A frame on the roll: its number, how long ago, and a way in. The counts, the hash and the exact signed time are on
  // its proof page.
  const inner = (
    <>
      <span className="rl-num">#{fmt(r.counter)}</span>
      <span className="rl-what">{epochStart !== null ? "Genesis" : ""}</span>
      {r.recordedMs !== null && <span className="rl-when" title={local(r.recordedMs)}>{ago(r.recordedMs, now)}</span>}
      <span className="rl-go" aria-hidden="true">&rsaquo;</span>
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

/** A closed epoch's root on Base: one write over every file proof of the epoch, sent right behind the next epoch's
 *  genesis. It is not a BitGraph, so it has no number and opens the Base transaction, not a proof page. */
function RootRow({ root }: { root: RollRoot }) {
  const now = useNow();
  const ms = root.blockTimestamp * 1000;
  const span = root.firstPos === root.lastPos ? `#${fmt(root.firstPos)}` : `#${fmt(root.firstPos)} to #${fmt(root.lastPos)}`;
  return (
    <a href={`https://basescan.org/tx/${root.txHash}`} target="_blank" rel="noopener" className="xp-row xp-row-base rl-row rl-link">
      <span className="rl-num">Root</span>
      <span className="rl-what">{`${fmt(root.records)} record${root.records === 1 ? "" : "s"}, ${span}`}</span>
      <span className="rl-when" title={local(ms)}>{ago(ms, now)}</span>
      <span className="rl-go" aria-hidden="true">&rsaquo;</span>
    </a>
  );
}

const isReads = (x: LedgerItem): x is ReadsRow => (x as ReadsRow).kind === "reads";
export function LedgerRows({ day, live, initial, newestKey, hasOlder, roots = [] }: { day: string; live: boolean; initial: LedgerItem[]; newestKey: string | null; hasOlder: boolean; roots?: RollRoot[] }) {
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
          // A row below the newest that was uploading, or looked short, when it was made: ask for its state again. A run
          // that is truly short stays so; one caught while its records were still landing comes right.
          const stale = rowsRef.current.filter((x, i) => isReads(x) && (x.state === "uploading" || x.state === "missing") && i > 0 && rowsRef.current.slice(0, i).some((y) => !isReads(y))) as ReadsRow[];
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
        {/* Block reads are part of the sequence but not frames anyone made; they stay on the proof pages. */}
        {/* A closed epoch's root sits on top of that epoch's rows, between its newest record and the next epoch's genesis. */}
        {rows.map((r, i) => {
          if (isReads(r)) return null;
          const epoch = epochOf(r);
          const newestOfEpoch = !rows.slice(0, i).some((x) => !isReads(x) && epochOf(x) === epoch);
          // Only on the page that holds the last record the root covers: an epoch that began just before midnight has
          // a row on the day before too, and the root belongs with the end of the epoch, once.
          const found = newestOfEpoch ? roots.find((x) => x.epoch === epoch) : undefined;
          const root = found && rows.some((x) => !isReads(x) && epochOf(x) === epoch && x.counter === found.lastPos) ? found : undefined;
          return root
            ? <Fragment key={r.key}><RootRow root={root} /><Row r={r} firstOfEpoch={firstOfEpoch(i)} /></Fragment>
            : <Row key={r.key} r={r} firstOfEpoch={firstOfEpoch(i)} />;
        })}
      </div>
      {older && (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={busy} onClick={() => void showOlder()}>{busy ? "Loading…" : "Show older"}</button>
        </div>
      )}
    </>
  );
}

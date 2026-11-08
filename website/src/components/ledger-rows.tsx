"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LedgerItem, LedgerRow } from "@/lib/running-ledger";
import type { ReadsRow } from "@/lib/timeline-ledger-core";
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

/** The viewer's own time, for the hover: the ledger's days are UTC days. */
function local(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

/** The epoch's closing note, byte for byte as the parent binds it (server/commit-service/src/parent/epoch-end.ts). */
function epochEndText(epochId: string): string {
  return JSON.stringify({
    format: "bitgraph-epoch-end/1",
    epochId,
    note: "The last BitGraph of this epoch. Nothing is bound after it: the enclave stops and its key is gone.",
  }, null, 2) + "\n";
}

/** Whether this row, the newest of its epoch on the page, is the epoch's closing BitGraph: its digest is the hash of the
 *  closing note for its epoch, which is the same text for every viewer, so it is checked here with no lookup. */
function useEpochEnd(r: LedgerRow, newestOfEpoch: boolean): boolean {
  const [end, setEnd] = useState(false);
  useEffect(() => {
    if (!newestOfEpoch || !r.digest) return;
    const urlSafe = r.key.split("/")[1] ?? "";
    const std = urlSafe.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (urlSafe.length % 4)) % 4);
    let gone = false;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(epochEndText(std))).then((buf) => {
      let b = ""; for (const x of new Uint8Array(buf)) b += String.fromCharCode(x);
      const h = btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (!gone && h === r.digest) setEnd(true);
    });
    return () => { gone = true; };
  }, [r.key, r.digest, newestOfEpoch]);
  return end;
}

function Row({ r, newestOfEpoch = false }: { r: LedgerRow; newestOfEpoch?: boolean }) {
  const epochEnd = useEpochEnd(r, newestOfEpoch);
  const now = useNow();
  // A frame on the roll: its number, how long ago, and a way in. The counts, the hash and the exact signed time are on
  // its proof page.
  const inner = (
    <>
      <span className="rl-num">#{fmt(r.counter)}</span>
      <span className="rl-what">{epochEnd ? "Closed" : ""}</span>
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

const isReads = (x: LedgerItem): x is ReadsRow => (x as ReadsRow).kind === "reads";
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
  const epochOf = (x: LedgerItem) => (isReads(x) ? x.epoch : x.key.split("/")[1]);
  return (
    <>
      <div className="rl-rows">
        {/* Older records of system reads are part of the sequence but not frames anyone made; they are not listed. */}
        {rows.map((r, i) => {
          if (isReads(r)) return null;
          const epoch = epochOf(r);
          const newestOfEpoch = !rows.slice(0, i).some((x) => !isReads(x) && epochOf(x) === epoch);
          return <Row key={r.key} r={r} newestOfEpoch={newestOfEpoch} />;
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

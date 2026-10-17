import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";
import { TerminalLine } from "@/components/terminal-line";
import { LedgerLive } from "@/components/ledger-live";
import { LEDGER_FIRST_DAY, countToday, rowsForDay, type LedgerRow } from "@/lib/running-ledger";

/**
 * The running ledger (Mike, 2026-10-17: "a running ledger like the base one"):
 * every BitGraph, newest first, one UTC day per page, today live. The Base
 * page's own layout and styles.
 *
 * Public (Mike, 2026-10-17: "nobody cares. make it. this is genesis of new BitGraph"): a row shows the
 * BitGraph's number, its two counts, the SHA-256 it bound and the enclave's signed time, and opens its proof
 * page. A hash cannot be turned back into the file; a guessable file can be confirmed by someone hashing their
 * own copy, which Mike accepted. This reverses the 2026-10-09 ruling against a browsable gallery.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Check a BitGraph",
  description: "Every BitGraph, as it is made: its number, its two counts and the SHA-256 it bound. Open any one for its proof.",
};

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y!, m! - 1, d! + delta)).toISOString().slice(0, 10);
}
function shortLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
function longLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}
function parseDay(raw: string | undefined, todayUTC: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (raw >= todayUTC || raw < LEDGER_FIRST_DAY) return null;
  return raw;
}
function when(ms: number): string {
  const d = new Date(ms);
  const md = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const t = d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${md}, ${t} UTC`;
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
const fmt = (n: number | string) => Number(n).toLocaleString("en-US");

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: rawDay } = await searchParams;
  const todayUTC = new Date().toISOString().slice(0, 10);
  const day = parseDay(rawDay, todayUTC);
  const shown = day ?? todayUTC;
  const prev = shiftDay(shown, -1);
  const next = day ? shiftDay(day, 1) : null;
  let rows: LedgerRow[] = [];
  let failed = false;
  let liveCount = 0;
  try {
    rows = await rowsForDay(shown);
    if (!day) liveCount = (await countToday()).count;
  } catch { failed = true; }

  return (
    <div className="frame" style={{ padding: "96px 0 96px", maxWidth: "var(--measure)" }}>
      <style>{`
        .rl-rows { display: flex; flex-direction: column; }
        .rl-row { display: flex; align-items: center; gap: 14px; }
        .rl-num { flex-shrink: 0; min-width: 92px; font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
        .rl-counts { flex-shrink: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rl-hash { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rl-when { flex-shrink: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rl-when-short { display: none; }
        .rl-link { color: inherit; text-decoration: none !important; }
        .rl-link:hover .rl-num { text-decoration: underline; }
        @media (max-width: 640px) {
          .rl-hash, .rl-when-long { display: none; }
          .rl-when-short { display: inline; }
          .rl-when { margin-left: auto; }
          .rl-num { min-width: 0; }
        }
      `}</style>
      {!day && !failed && <LedgerLive day={todayUTC} count={liveCount} />}
      <TerminalLine text="Check a BitGraph." />

      {/* Check is the ledger (Mike, 2026-10-17): the drop box here only looks files up and never makes one; the
          one on /make makes (Mike, 2026-10-17: the SHA-256 field went, "dont need this"). */}
      <div style={{ margin: "32px 0 0" }}>
        <DropBox mode="check" />
      </div>

      {/* The ledger itself, under the checker: every BitGraph by day. */}
      <div style={{ height: 96 }} aria-hidden="true" />
      {/* LEDGER on the left, the day links and Calendar on the right; no paragraph (Mike, 2026-10-17). */}
      <div className="ledger-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "0 0 20px" }}>
        <div>
          <p className="home-kicker" style={{ margin: 0 }}>Ledger</p>
          {day && <p style={{ color: "var(--dim)", margin: "4px 0 0" }}>{`${longLabel(day)} (UTC)`}</p>}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {prev >= LEDGER_FIRST_DAY && (
            <a href={`/ledger?day=${prev}`} className="bg-action-link" style={{ margin: 0 }}>
              <span className="arrow" aria-hidden>&larr;</span> {shortLabel(prev)}
            </a>
          )}
          {next && (
            <a href={next >= todayUTC ? "/ledger" : `/ledger?day=${next}`} className="bg-action-link" style={{ margin: 0 }}>
              {next >= todayUTC ? "Today" : shortLabel(next)} <span className="arrow" aria-hidden>&rarr;</span>
            </a>
          )}
          {day && next && next < todayUTC && <a href="/ledger" className="bg-action-link" style={{ margin: 0 }}>Today</a>}
          <a href="/ledger/calendar" className="bg-action-link" style={{ margin: 0 }}>Calendar</a>
        </div>
      </div>

      {failed ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--faint)", fontSize: 14 }}>The ledger could not be read. Try again in a moment.</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--faint)", fontSize: 14 }}>No BitGraphs on this day yet.</div>
      ) : (
        <div className="rl-rows">
          {rows.map((r) => (
            r.digest ? (
              <a key={r.proofHash} href={`/proof/${r.digest}`} className="xp-row xp-row-base rl-row rl-link">
              <span className="rl-num">#{fmt(r.counter)}</span>
              <span className="rl-counts">{r.nonceCounter ? `counts ${fmt(r.nonceCounter)}, ${fmt(r.counter)}` : ""}{r.anchor ? " · anchor" : ""}</span>
              <span className="rl-hash" title="SHA-256 of the bound content">{r.digest ?? r.proofHash}</span>
              {r.recordedMs !== null && (
                <span className="rl-when">
                  <span className="rl-when-long">{when(r.recordedMs)}</span>
                  <span className="rl-when-short">{clock(r.recordedMs)}</span>
                </span>
              )}
            </a>
            ) : (
              <div key={r.proofHash} className="xp-row xp-row-base rl-row">
              <span className="rl-num">#{fmt(r.counter)}</span>
              <span className="rl-counts">{r.nonceCounter ? `counts ${fmt(r.nonceCounter)}, ${fmt(r.counter)}` : ""}{r.anchor ? " · anchor" : ""}</span>
              <span className="rl-hash" title="SHA-256 of the bound content">{r.digest ?? r.proofHash}</span>
              {r.recordedMs !== null && (
                <span className="rl-when">
                  <span className="rl-when-long">{when(r.recordedMs)}</span>
                  <span className="rl-when-short">{clock(r.recordedMs)}</span>
                </span>
              )}
            </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
